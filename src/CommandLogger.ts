import { exec } from 'shelljs'
import { LogFile } from './logging'
import { getCurrentTimeStamp } from './util'
import {
  Api,
  LogType,
  AddProjectBuildLogsResponseBody,
  ProjectBuild,
} from './api'

type CommandFinishedResult = {
  runtimeMs: number
  commandStopped?: {
    cancelled: boolean
    timedOut: boolean
  }
}

type AllLogsSentResult = {
  errors: boolean
  doneEventError?: Error
  sendChunkErrors?: Array<Error>
  commandReturnCode: number
}

const NEWLINES_REGEX: RegExp = /\r\n|\r|\n/

export default class CommandLogger {
  private projectBuild: ProjectBuild

  private start: number = getCurrentTimeStamp()
  private end: number | undefined

  private stdout: string = ''
  private stderr: string = ''

  private stdoutAvailable: boolean = true
  private stderrAvailable: boolean = true

  private promises: { [logType in LogType]: Array<Promise<any>> } = {
    stdout: [],
    stderr: [],
  }

  private commandFinished: Promise<CommandFinishedResult>
  private resolveCommandFinishedPromise: (
    commandFinishedResult: CommandFinishedResult,
  ) => void

  private allLogsSent: Promise<AllLogsSentResult>
  private resolveAllLogsSentPromise: (
    allLogsSentResult: AllLogsSentResult,
  ) => void

  private api: Api

  private logFile: LogFile

  constructor(
    projectBuild: ProjectBuild,
    api: Api,
    cwd: string,
    logFile: LogFile,
  ) {
    this.projectBuild = projectBuild
    this.api = api
    this.logFile = logFile

    this.resolveCommandFinishedPromise = (
      commandFinishedResult: CommandFinishedResult,
    ) => {
      throw Error('CommandLogger.resolveCommandFinishedPromise() called before being bound to commandFinished Promise') // prettier-ignore
    }

    this.commandFinished = new Promise((resolve) => {
      this.resolveCommandFinishedPromise = (
        commandFinishedResult: CommandFinishedResult,
      ) => {
        resolve(commandFinishedResult)
      }
    })

    this.resolveAllLogsSentPromise = (allLogsSentResult: AllLogsSentResult) => {
      throw Error('CommandLogger.resolveAllLogsSentPromise() called before being bound to allLogsSent Promise') // prettier-ignore
    }

    this.allLogsSent = new Promise((resolve) => {
      this.resolveAllLogsSentPromise = (
        allLogsSentResult: AllLogsSentResult,
      ) => {
        resolve(allLogsSentResult)
      }
    })

    try {
      const command = exec(
        this.projectBuild.commandString,
        {
          async: true,

          // sets shelljs current working directory to where the cli is run from,
          // instead of the directory where the cli script is
          cwd,

          // pass config in as env vars for the script to use
          env: {
            BOXCI_PROJECT: this.projectBuild.projectId,
            BOXCI_COMMIT: this.projectBuild.gitCommit,
            BOXCI_BRANCH: this.projectBuild.gitBranch,
            BOXCI_PROJECT_BUILD_ID: this.projectBuild.id,
            BOXCI_COMMAND: this.projectBuild.commandString,
            BOXCI_MACHINE: this.projectBuild.machineName,
          },
        },
        (code: number) => {
          // If command finished, code will be a number
          //
          // So check this is the case before setting the command finished,
          //
          // This is necessary because this callback also gets called
          // when the command didn't finish, for example it runs with
          // code === null when the process is killed with SIGHUP
          // if the build was cancelled or timed out
          if (code !== undefined && code !== null) {
            this.setCommandFinished(code)
          }
        },
      )

      // if there was an error, commandResult will be undefined
      if (!command) {
        this.handleCommandExecError(
          projectBuild.projectId,
          this.projectBuild.commandString,
        )
      }

      const { stdout, stderr } = command

      const stopBuildIfCancelledOrTimedOut = (
        res: AddProjectBuildLogsResponseBody,
      ) => {
        // res is only populated if build has been cancelled or timed out
        // so if it is undefined, it means just continue
        if (res && (res.cancelled || res.timedOut)) {
          // send SIGHUP to the controlling process, which will kill all the command(s) being run
          // even if they are chained together with semicolons
          command.kill('SIGHUP')

          // because everything is async, just give a few seconds
          // for any remaining stdout or stderr to come through before
          // setting the command stopped, otherwise output might
          // overlap with Box CI logs after command is stopped
          setTimeout(() => {
            this.setCommandStopped(res)
          }, 3000)
        }
      }

      this.logFile.write('INFO', `Running command "${this.projectBuild.commandString}" - runId ${this.projectBuild.id}`) // prettier-ignore

      if (stdout) {
        stdout.on('data', (chunk: string) => {
          this.sendChunk('stdout', chunk).then(stopBuildIfCancelledOrTimedOut)
        })
        this.logFile.write(
          'DEBUG',
          `Listening to stdout for "${this.projectBuild.commandString}"`,
        )
      } else {
        this.stdoutAvailable = false
        this.logFile.write(
          'DEBUG',
          `No stdout available for "${this.projectBuild.commandString}"`,
        )
      }

      if (stderr) {
        stderr.on('data', (chunk: string) => {
          this.sendChunk('stderr', chunk).then(stopBuildIfCancelledOrTimedOut)
        })
        this.logFile.write(
          'DEBUG',
          `Listening to stderr for "${this.projectBuild.commandString}"`,
        )
      } else {
        this.stderrAvailable = false
        this.logFile.write(
          'DEBUG',
          `No stderr available for "${this.projectBuild.commandString}"`,
        )
      }
    } catch (err) {
      // this is a catch-all error handler from anything above
      this.handleCommandExecError(
        projectBuild.projectId,
        this.projectBuild.commandString,
        err,
      )
    }
  }

  private handleCommandExecError(
    projectId: string,
    commandString: string,
    err?: Error,
  ) {
    if (commandString) {
      console.log(`Error running build command [ ${commandString} ]\n\nCaused by:\n\n`, err, '\n\n' ) // prettier-ignore
    } else {
      console.log(`No build command specified for this project.\n\nSet it at https://boxci.dev/project/${projectId}`) // prettier-ignore
    }

    process.exit(1)
  }

  public whenCommandFinished() {
    return this.commandFinished
  }

  public whenAllLogsSent() {
    return this.allLogsSent
  }

  private sendChunk(logType: LogType, chunkContent: string) {
    const chunkIndex = this.promises[logType].length
    this.logFile.write('DEBUG', `Sending ${logType} chunk index ${chunkIndex}`)

    const chunkSentPromise = this.api
      .addProjectBuildLogs({
        // project build id
        id: this.projectBuild.id,
        // log type
        t: logType,
        // chunk index
        i: chunkIndex,
        // chunk
        c: {
          // content
          c: chunkContent,
          // time since start in milliseconds
          t: getCurrentTimeStamp() - this.start,
          // starting line number (0 based)
          l: this[logType].split(NEWLINES_REGEX).length - 1,
        },
      })
      .catch((err) => {
        // catch and return any thrown error as the resolved value of the promise, i.e
        // do not throw, stop the program, and stop other requests from sending
        // we'll send as many chunks as we can, then once all promises have resolved,
        // check if any of them resolved to errors and show the errors at the end
        // by rejecting the allLogsSent promise
        return err
      })

    // add to the complete log string to get starting lineNumber for future chunks
    this[logType] += chunkContent

    this.promises[logType].push(chunkSentPromise)

    return chunkSentPromise
  }

  private setCommandStopped(res: AddProjectBuildLogsResponseBody) {
    const runtimeMs = getCurrentTimeStamp() - this.start

    this.resolveCommandFinishedPromise({
      runtimeMs,
      commandStopped: {
        cancelled: res.cancelled,
        timedOut: res.timedOut,
      },
    })
  }

  private async setCommandFinished(commandReturnCode: number): Promise<void> {
    this.end = getCurrentTimeStamp()
    const commandRuntimeMillis = this.end - this.start

    const commandLogsTotalChunksStdout = this.promises.stdout.length + 0
    const commandLogsTotalChunksStderr = this.promises.stderr.length + 0

    if (this.logFile.logLevel === 'INFO') {
      this.logFile.write('INFO', `Command finished in ${commandRuntimeMillis}ms with code ${commandReturnCode} - sending done event`) // prettier-ignore
    } else {
      this.logFile.write('DEBUG', `Command finished in ${commandRuntimeMillis}ms with code ${commandReturnCode} - ${commandLogsTotalChunksStdout} stdout chunks - ${commandLogsTotalChunksStderr} stderr chunks - sending done event`) // prettier-ignore
    }

    this.resolveCommandFinishedPromise({ runtimeMs: commandRuntimeMillis })

    // send the done event and also wait for all still outgoing stout and stderr chunks to send before resolving
    const doneEventSent = this.api
      .setProjectBuildDone({
        projectBuildId: this.projectBuild.id,
        commandReturnCode,
        commandRuntimeMillis,
        commandLogsTotalChunksStdout,
        commandLogsTotalChunksStderr,
        commandLogsAvailableStdout: this.stdoutAvailable,
        commandLogsAvailableStderr: this.stderrAvailable,
      })
      .catch((err) => {
        // return the error as the resolved value of the promise, see notes above
        return err
      })

    const [doneEventResult, ...results] = await Promise.all([
      doneEventSent,
      ...this.promises.stdout,
      ...this.promises.stderr,
    ])

    const isDoneEventError = doneEventResult instanceof Error
    const sendChunkErrors: Array<Error> = []
    for (let result of results) {
      if (result instanceof Error) {
        sendChunkErrors.push(result)
      }
    }

    if (!isDoneEventError && sendChunkErrors.length === 0) {
      this.resolveAllLogsSentPromise({
        errors: false,
        commandReturnCode,
      })
    } else {
      this.resolveAllLogsSentPromise({
        errors: true,
        doneEventError: isDoneEventError
          ? (doneEventResult as Error)
          : undefined,
        sendChunkErrors,
        commandReturnCode,
      })
    }
  }
}
