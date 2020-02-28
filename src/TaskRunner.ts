import { exec } from 'child_process'
import { LogFile } from './logging'
import { getCurrentTimeStamp } from './util'
import {
  Api,
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
  commandReturnCode: number
}

// TODO this is how to get line numebrs from the string
//
// this[logType].split(NEWLINES_REGEX).length - 1,
// const NEWLINES_REGEX: RegExp = /\r\n|\r|\n/

const logTask = (task: ProjectBuildTask) =>
  `task [ ${task.n} ] with command [ ${task.c} ]`

export default class CommandLogger {
  private projectBuild: ProjectBuild
  private taskIndex: number
  private task: ProjectBuildTask

  private start: number = getCurrentTimeStamp()
  private end: number | undefined

  private logs = ''

  // pointer to the length of logs already sent to the server
  // used to work out which logs are new and need to be sent
  // to the server as new logs are added
  private logsSentLength = 0

  // a lock for when logs are sending, so we don't overlap requests
  // to append logs
  private sendingLogs = false

  // timestamp when logs were last sent
  private logsLastSentAt = 0

  // minimum time in milliseconds between sending logs
  private sendLogsInterval = 5000

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

  // ignore the fact that commandExecution is not definitely assigned,
  // we can assume it is
  //
  // @ts-ignore
  private commandExecution: ReturnType<typeof exec>

  constructor(
    projectBuild: ProjectBuild,
    taskIndex: number,
    api: Api,
    cwd: string,
    logFile: LogFile,
  ) {
    this.projectBuild = projectBuild
    this.taskIndex = taskIndex
    this.task = projectBuild.pipeline.t[taskIndex]
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
      this.commandExecution = exec(this.task.c, {
        // sets shelljs current working directory to where the cli is run from,
        // instead of the directory where the cli script is
        cwd,

        // pass config in as env vars for the script to use
        env: {
          ...process.env,

          BOXCI_PROJECT: this.projectBuild.projectId,
          BOXCI_PROJECT_BUILD_ID: this.projectBuild.id,
          BOXCI_TASK_INDEX: this.task.n,
          BOXCI_TASK_NAME: this.task.n,
          BOXCI_TASK_COMMAND: this.task.c,

          BOXCI_COMMIT: this.projectBuild.gitCommit,
          BOXCI_BRANCH: this.projectBuild.gitBranch,

          BOXCI_AGENT_NAME: this.projectBuild.agentName,

          // these are vars that might be missing
          // just don't pass them rather than passing as undefined
          ...(this.projectBuild.gitTag && {
            BOXCI_TAG: this.projectBuild.gitTag,
          }),
        },
      })

      this.commandExecution.on('error', (err: any) => {
        console.log(err)
        console.log(process.env.PATH)
        throw err
      })

      this.commandExecution.on('close', (code: number) => {
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
      if (!this.commandExecution) {
        this.handleCommandExecError(this.task)
      }

      const { stdout, stderr } = this.commandExecution

      this.logFile.write(
        'INFO',
        `Running ${logTask(this.task)} - build id: [ ${this.projectBuild.id} ]`,
      )

      if (stdout) {
        stdout.on('data', (chunk: string) => {
          this.sendTaskLogs(chunk)
        })
        this.logFile.write(
          'DEBUG',
          `Listening to stdout for ${logTask(this.task)}`,
        )
      } else {
        this.logFile.write(
          'DEBUG',
          `No stdout available for ${logTask(this.task)}`,
        )
      }

      if (stderr) {
        stderr.on('data', (chunk: string) => {
          this.sendTaskLogs(chunk)
        })
        this.logFile.write(
          'DEBUG',
          `Listening to stderr for ${logTask(this.task)}`,
        )
      } else {
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

  private stopBuildIfCancelledOrTimedOut(
    res: AddProjectBuildTaskLogsResponseBody | undefined,
  ) {
    // res is only populated if build has been cancelled or timed out
    // so if it is undefined, it means just continue
    if (res && (res.cancelled || res.timedOut)) {
      // send SIGHUP to the controlling process, which will kill all the command(s) being run
      // even if they are chained together with semicolons
      this.commandExecution.kill('SIGHUP')

      // because everything is async, just give a few seconds
      // for any remaining stdout or stderr to come through before
      // setting the command stopped, otherwise output might
      // overlap with Box CI logs after command is stopped
      setTimeout(() => {
        this.setCommandStopped(res)
      }, 3000)
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

  private async sendTaskLogs(newLogs: string) {
    this.logFile.write('DEBUG', `[task ${this.task.n}] sending logs`)

    // append the logs to the local cache
    this.logs += newLogs

    // if lock is taken, don't send - this avaoids overlapping requests
    // and appending logs out of order on the server
    if (this.sendingLogs) {
      return
    }

    // if nothing to send, just exit
    if (this.logsSentLength === this.logs.length) {
      return
    }

    // if we last sent logs less than INTERVAL ago, just exit.
    // We'll wait for the next set of logs to come through and
    // for this to be called again or, if this was the last log update,
    // for the task done logic to call this again
    const now = getCurrentTimeStamp()
    if (now < this.logsLastSentAt + this.sendLogsInterval) {
      return
    }

    // otherwise take a diff of current logs and what's on server and just send the extra logs to append
    const logsToAdd = this.logs.substring(this.logsSentLength)

    // save this value as a closure for use later
    // (it's async and this.logs might change in the meantime if we don't store the value now)
    const newLogsSentLengthIfSuccessful = this.logs.length + 0

    // take lock and set time last sent
    this.sendingLogs = true
    this.logsLastSentAt = now

    // send logs asynchronously - this gives other code the opportunity to run and is why we need the lock
    // to stop overlapping requests from this function being called again in the meantime
    try {
      const res = await this.api.addProjectBuildTaskLogs({
        id: this.projectBuild.id,
        i: this.taskIndex,
        l: logsToAdd,
      })

      // only if successful, update pointer
      this.logsSentLength = newLogsSentLengthIfSuccessful

      // if the response indicates the build was timed out or cancelled, stop it
      this.stopBuildIfCancelledOrTimedOut(res)
    } catch (err) {
      // just ignore any error and continue, sending the logs will be retried again
      // when new logs come through or when the task completes
    }

    // release lock
    this.sendingLogs = false
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

    this.logFile.write('INFO', `${logTask(this.task)} ran in ${commandRuntimeMillis}ms with return code ${commandReturnCode}`) // prettier-ignore
    this.logFile.write('INFO', `sending task done event`)

    this.resolveCommandFinishedPromise({ runtimeMs: commandRuntimeMillis })

    // send the task done event
    const taskDoneEventSent = this.api
      .setProjectBuildTaskDone({
        projectBuildId: this.projectBuild.id,
        taskIndex: this.taskIndex,
        commandReturnCode,
        commandRuntimeMillis,
      })
      .catch((err) => {
        // return the error as the resolved value of the promise, see notes above
        return err
      })

    // flush all remaining logs
    this.logsLastSentAt = 0
    const allTaskLogsSent = this.sendTaskLogs('')

    await Promise.all([taskDoneEventSent, allTaskLogsSent])

    this.resolveAllLogsSentPromise({ commandReturnCode })
  }
}
