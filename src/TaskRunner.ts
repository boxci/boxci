import { exec } from 'child_process'
import { LogFile } from './logging'
import { getCurrentTimeStamp } from './util'
import {
  Api,
  ProjectBuild,
  ProjectBuildTask,
  AddProjectBuildTaskLogsResponseBody,
} from './api'

type TaskRunnerResult = {
  commandReturnCode: number
  commandRuntimeMs: number
  cancelled?: boolean
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

  // minimum time in milliseconds between sending logs
  private sendLogsInterval = 5000
  private sendLogsIntervalReference: NodeJS.Timeout

  private taskRunnerDone: Promise<TaskRunnerResult>
  private resolveTaskRunnerDonePromise: (
    taskRunnerResult: TaskRunnerResult,
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

    this.resolveTaskRunnerDonePromise = (
      taskRunnerResult: TaskRunnerResult,
    ) => {
      throw Error('TaskRunner.resolveTaskRunnerDonePromise() called before being bound to taskRunnerDone Promise') // prettier-ignore
    }

    this.taskRunnerDone = new Promise((resolve) => {
      this.resolveTaskRunnerDonePromise = (
        taskRunnerResult: TaskRunnerResult,
      ) => {
        resolve(taskRunnerResult)
      }
    })

    this.sendLogsIntervalReference = setInterval(() => {
      this.pushLogsToServer()
    }, this.sendLogsInterval)

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
          this.completeTask(code)
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
          this.addLogs(chunk)
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
          this.addLogs(chunk)
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

  private stopBuildIfCancelled(
    res: AddProjectBuildTaskLogsResponseBody | undefined,
  ) {
    // res is only populated if build has been cancelled
    // so if it is undefined, it means just continue
    if (res && res.cancelled) {
      // send SIGHUP to the controlling process, which will kill all the command(s) being run
      // even if they are chained together with semicolons
      this.commandExecution.kill('SIGHUP')

      const runtimeMs = getCurrentTimeStamp() - this.start

      this.resolveTaskRunnerDonePromise({
        commandReturnCode: 1, // not used for anything, just set to arbitrary error code so it's not undefined and TS doesn't complain
        commandRuntimeMs: runtimeMs,
        cancelled: res.cancelled,
      })
    }
  }

  private handleCommandExecError(task: ProjectBuildTask, err?: Error) {
    console.log(`Error running ${logTask(task)}`)

    if (err) {
      console.log(`\nCaused by:\n\n`, err, '\n\n')
    }

    process.exit(1)
  }

  public done() {
    return this.taskRunnerDone
  }

  private addLogs(newLogs: string) {
    this.logs += newLogs
  }

  private async pushLogsToServer(taskCompleted?: boolean, retries?: number) {
    // if lock is taken, don't send - this avoids overlapping requests
    // and appending logs out of order on the server
    if (this.sendingLogs) {
      return
    }

    // only send new logs that haven't already been sent
    const logsToAdd = this.logs.substring(this.logsSentLength)

    // save this value for later use
    // (it's async and this.logs might change in the meantime if we don't store the value now)
    const newLogsSentLengthIfSuccessful = this.logs.length + 0

    // send logs asynchronously
    this.sendingLogs = true
    try {
      const res = await this.api.addProjectBuildTaskLogs({
        id: this.projectBuild.id,
        i: this.taskIndex,
        l: logsToAdd,
      })

      // only if successful, update pointer
      this.logsSentLength = newLogsSentLengthIfSuccessful

      // if the response indicates the build was timed out or cancelled, stop it
      this.stopBuildIfCancelled(res)

      // release lock
      this.sendingLogs = false
    } catch (err) {
      // release lock
      this.sendingLogs = false

      // if task not yet completed, this will be called again automatically
      // so just ignore any error. If it is completed, retry pushing the logs
      if (taskCompleted) {
        let retryCount = retries === undefined ? 1 : retries + 1

        if (retryCount < 5) {
          await this.pushLogsToServer(true, retryCount)
        }

        // after 5 retries without success just stop
        //
        // TODO should this be an error? Or perhaps at least send
        // the 'last logs' flag up with the request so server knows
        // whether or not it received last logs request for a task
      }
    }
  }

  private async completeTask(commandReturnCode: number): Promise<void> {
    this.end = getCurrentTimeStamp()
    const commandRuntimeMillis = this.end - this.start

    this.logFile.write('INFO', `${logTask(this.task)} ran in ${commandRuntimeMillis}ms with return code ${commandReturnCode}`) // prettier-ignore
    this.logFile.write('INFO', `sending task done event`)

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
    clearInterval(this.sendLogsIntervalReference)
    const allLogsSent = this.pushLogsToServer(true)

    // wait until both done, then resolve allLogsSentPromise
    await Promise.all([taskDoneEventSent, allLogsSent])

    this.resolveTaskRunnerDonePromise({
      commandReturnCode: commandReturnCode,
      commandRuntimeMs: commandRuntimeMillis,
    })
  }
}
