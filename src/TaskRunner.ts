import { spawn } from 'child_process'
import { LogFile } from './logging'
import { getCurrentTimeStamp } from './util'
import {
  Api,
  LogType,
  ProjectBuild,
  ProjectBuildTask,
  AddProjectBuildTaskLogsResponseBody,
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

const logTask = (task: ProjectBuildTask) =>
  `task [ ${task.name} ] with command [ ${task.command} ]`

export default class CommandLogger {
  private projectBuild: ProjectBuild
  private taskIndex: number
  private task: ProjectBuildTask

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
    taskIndex: number,
    api: Api,
    cwd: string,
    logFile: LogFile,
  ) {
    this.projectBuild = projectBuild
    this.taskIndex = taskIndex
    this.task = projectBuild.pipeline.tasks[taskIndex]
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
      const commandExecution = spawn(this.task.command, [], {
        // sets shelljs current working directory to where the cli is run from,
        // instead of the directory where the cli script is
        cwd,

        // pass config in as env vars for the script to use
        env: {
          ...process.env,

          BOXCI_PROJECT: this.projectBuild.projectId,
          BOXCI_PROJECT_BUILD_ID: this.projectBuild.id,
          BOXCI_TASK_INDEX: this.task.name,
          BOXCI_TASK_NAME: this.task.name,
          BOXCI_TASK_COMMAND: this.task.command,

          BOXCI_COMMIT: this.projectBuild.gitCommit,
          BOXCI_BRANCH: this.projectBuild.gitBranch,

          // these are vars that might be missing
          // just don't pass them rather than passing as undefined
          ...(this.projectBuild.machineName && {
            BOXCI_MACHINE: this.projectBuild.machineName,
          }),
          ...(this.projectBuild.gitTag && {
            BOXCI_TAG: this.projectBuild.gitTag,
          }),
        },
      })

      commandExecution.on('close', (code: number) => {
        // If command finished, code will be a number
        //
        // So check this is the case before setting the command finished,
        //
        // This is necessary because this also gets called
        // when the command didn't finish, for example it runs with
        // code === null when the process is killed with SIGHUP
        // if the build was cancelled or timed out
        if (code !== undefined && code !== null) {
          this.setCommandFinished(code)
        }
      })

      // if there was an error, commandRun will be undefined
      if (!commandExecution) {
        this.handleCommandExecError(this.task)
      }

      const { stdout, stderr } = commandExecution

      const stopBuildIfCancelledOrTimedOut = (
        res: AddProjectBuildTaskLogsResponseBody,
      ) => {
        // res is only populated if build has been cancelled or timed out
        // so if it is undefined, it means just continue
        if (res && (res.cancelled || res.timedOut)) {
          // send SIGHUP to the controlling process, which will kill all the command(s) being run
          // even if they are chained together with semicolons
          commandExecution.kill('SIGHUP')

          // because everything is async, just give a few seconds
          // for any remaining stdout or stderr to come through before
          // setting the command stopped, otherwise output might
          // overlap with Box CI logs after command is stopped
          setTimeout(() => {
            this.setCommandStopped(res)
          }, 3000)
        }
      }

      this.logFile.write(
        'INFO',
        `Running ${logTask(this.task)} - build id: [ ${this.projectBuild.id} ]`,
      )

      if (stdout) {
        stdout.on('data', (chunk: string) => {
          this.sendChunk('stdout', chunk).then(stopBuildIfCancelledOrTimedOut)
        })
        this.logFile.write(
          'DEBUG',
          `Listening to stdout for ${logTask(this.task)}`,
        )
      } else {
        this.stdoutAvailable = false
        this.logFile.write(
          'DEBUG',
          `No stdout available for ${logTask(this.task)}`,
        )
      }

      if (stderr) {
        stderr.on('data', (chunk: string) => {
          this.sendChunk('stderr', chunk).then(stopBuildIfCancelledOrTimedOut)
        })
        this.logFile.write(
          'DEBUG',
          `Listening to stderr for ${logTask(this.task)}`,
        )
      } else {
        this.stderrAvailable = false
        this.logFile.write(
          'DEBUG',
          `No stderr available for ${logTask(this.task)}`,
        )
      }
    } catch (err) {
      // this is a catch-all error handler from anything above
      this.handleCommandExecError(this.task, err)
    }
  }

  private handleCommandExecError(task: ProjectBuildTask, err?: Error) {
    console.log(`Error running ${logTask(task)}`)

    if (err) {
      console.log(`\nCaused by:\n\n`, err, '\n\n')
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

    this.logFile.write(
      'DEBUG',
      `[task ${this.task.name}] sending ${logType} chunk [${chunkIndex}]`,
    )

    const chunkSentPromise = this.api
      .addProjectBuildTaskLogs({
        // project build id
        id: this.projectBuild.id,
        // task index
        ti: this.taskIndex,
        // log type
        t: logType,
        // chunk index
        ci: chunkIndex,
        // chunk
        c: {
          // content
          c: chunkContent,
          // starting line number (0 based)
          l: this[logType].split(NEWLINES_REGEX).length - 1,
          // time since start in milliseconds
          t: getCurrentTimeStamp() - this.start,
        },
      })
      .catch((err: any) => {
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

  private setCommandStopped(res: AddProjectBuildTaskLogsResponseBody) {
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

    const totalChunksStdout = this.promises.stdout.length + 0
    const totalChunksStderr = this.promises.stderr.length + 0

    if (this.logFile.logLevel === 'INFO') {
      this.logFile.write('INFO', `${logTask(this.task)} ran in ${commandRuntimeMillis}ms with return code ${commandReturnCode}`) // prettier-ignore
    } else {
      this.logFile.write('DEBUG', `${logTask(this.task)} ran in ${commandRuntimeMillis}ms with return code ${commandReturnCode} - ${totalChunksStdout} total stdout chunks - ${totalChunksStderr} total stderr chunks`) // prettier-ignore
    }
    this.logFile.write('INFO', `sending task done event`)

    this.resolveCommandFinishedPromise({ runtimeMs: commandRuntimeMillis })

    // send the done event and also wait for all still outgoing stout and stderr chunks to send before resolving
    const taskDoneEventSent = this.api
      .setProjectBuildTaskDone({
        projectBuildId: this.projectBuild.id,
        taskIndex: this.taskIndex,
        logsMeta: {
          r: commandReturnCode,
          t: commandRuntimeMillis,

          // -1 for chunks count used to signal that channel was not available
          // basically we never expect this, but just to accommodate it in case
          // it should happen
          co: this.stdoutAvailable === false ? -1 : totalChunksStdout,
          ce: this.stderrAvailable === false ? -1 : totalChunksStderr,
        },
      })
      .catch((err) => {
        // return the error as the resolved value of the promise, see notes above
        return err
      })

    const [doneEventResult, ...results] = await Promise.all([
      taskDoneEventSent,
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
