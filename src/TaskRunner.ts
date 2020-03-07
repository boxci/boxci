import { exec } from 'child_process'
import { LogFile } from './logging'
import { getCurrentTimeStamp, wait } from './util'
import { Api, ProjectBuild, ProjectBuildTask } from './api'

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
  private sendLogsIntervalReference: NodeJS.Timeout | undefined = undefined
  private cwd: string
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
    this.cwd = cwd
    this.api = api
    this.logFile = logFile
  }

  public async run() {
    // tell the server the task has started before running the command
    await this.api.setProjectBuildTaskStarted({
      projectBuildId: this.projectBuild.id,
      taskIndex: this.taskIndex,
    })

    return this.runCommand()
  }

  private runCommand(): Promise<TaskRunnerResult> {
    return new Promise((resolve, reject) => {
      // push command logs to server every interval
      this.sendLogsIntervalReference = setInterval(() => {
        this.pushLogsToServer(resolve, reject)
      }, this.sendLogsInterval)

      try {
        this.commandExecution = exec(this.task.c, {
          // sets shelljs current working directory to where the cli is run from,
          // instead of the directory where the cli script is
          cwd: this.cwd,
          // pass config in as env vars for the script to use
          env: this.getCommandEnvVars(),
        })

        this.commandExecution.on('error', (err: any) => {
          reject(err)
        })

        this.commandExecution.on('close', (code: number) => {
          // Check code is a number and if so, complete task.
          //
          // This is necessary because the 'close' event also fires when the process
          // is killed with SIGHUP if the build was cancelled, but code will be undefined
          if (code !== undefined && code !== null && typeof code === 'number') {
            this.completeTask(resolve, reject, code)
          }
        })

        // if commandExecution is undefined, there was some error starting the command
        if (!this.commandExecution) {
          reject(Error('Error starting command'))
        }

        const { stdout, stderr } = this.commandExecution
        this.logFile.write('INFO', `Running ${logTask(this.task)} - build id: [ ${this.projectBuild.id} ]`) // prettier-ignore

        if (stdout) {
          stdout.on('data', (chunk) => {
            this.logFile.write('INFO', `stdout chunk: ${chunk}`)
            this.addLogs(chunk)
          })
          this.logFile.write('DEBUG', `Listening to stdout for ${logTask(this.task)}`) // prettier-ignore
        } else {
          this.logFile.write('DEBUG', `No stdout available for ${logTask(this.task)}`) // prettier-ignore
        }

        if (stderr) {
          stderr.on('data', (chunk) => {
            this.logFile.write('INFO', `stderr chunk: ${chunk}`)
            this.addLogs(chunk)
          })
          this.logFile.write('DEBUG', `Listening to stderr for ${logTask(this.task)}`) // prettier-ignore
        } else {
          this.logFile.write('DEBUG', `No stderr available for ${logTask(this.task)}`) // prettier-ignore
        }
      } catch (err) {
        reject(err)
      }
    })
  }

  private getCommandEnvVars() {
    return {
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
    }
  }

  private addLogs(newLogs: string) {
    this.logs += newLogs
  }

  private async pushLogsToServer(
    resolveRunCommandPromise: (result: TaskRunnerResult) => void,
    rejectRunCommandPromise: any,
    taskCompleted?: boolean,
    retries?: number,
  ) {
    // if lock is taken, don't send - this avoids overlapping requests & appending logs out of order on the server
    if (this.sendingLogs) {
      return
    }

    // only send new logs that haven't already been sent
    const logsToAdd = this.logs.substring(this.logsSentLength)

    // save this value for later use - this is an async function and this.logs might change in the meantime if we don't store the value now
    const newLogsSentLengthIfSuccessful = this.logs.length + 0

    // send logs
    this.sendingLogs = true
    try {
      const res = await this.api.addProjectBuildTaskLogs({
        id: this.projectBuild.id,
        i: this.taskIndex,
        l: logsToAdd,
      })

      // only if successful, update pointer
      this.logsSentLength = newLogsSentLengthIfSuccessful

      // if the build was cancelled since the last logs were sent, stop it
      if (res && res.cancelled) {
        // send SIGHUP to the controlling process, which will kill all the command(s) being run even if they are chained together with semicolons
        this.commandExecution.kill('SIGHUP')

        resolveRunCommandPromise({
          commandRuntimeMs: getCurrentTimeStamp() - this.start,
          cancelled: res.cancelled,
          commandReturnCode: 1, // not used for anything, just set to generic error code so TS doesn't complain
        })
      }

      this.sendingLogs = false
    } catch (err) {
      this.sendingLogs = false

      // if task not yet completed, this will be called again automatically so just ignore any errors.
      if (!taskCompleted) {
        return
      }

      // If it is completed, this is the last chance to push all the logs so don't fail straight away
      // as we won't get to retry - actually retry 5 times
      if (taskCompleted) {
        let retryCount = retries === undefined ? 0 : retries + 1

        if (retryCount < 5) {
          await wait(2000) // wait a couple of seconds before retrying
          await this.pushLogsToServer(
            resolveRunCommandPromise,
            rejectRunCommandPromise,
            true,
            retryCount,
          )
        } else {
          // after 5 retries without success just reject
          rejectRunCommandPromise(err)
        }
      }
    }
  }

  private async completeTask(
    resolveRunCommandPromise: (result: TaskRunnerResult) => void,
    rejectRunCommandPromise: any,
    commandReturnCode: number,
  ): Promise<void> {
    const commandRuntimeMillis = getCurrentTimeStamp() - this.start

    if (this.sendLogsIntervalReference) {
      clearInterval(this.sendLogsIntervalReference)
    }
    // wait a few seconds to give any last logs enough time to come through
    // they come in asynchronously, and may do so after the 'close' event fires and this function is called
    //
    // TODO there is probably a better way to do this so we don't have to wait unecessarily
    wait(2000)

    // flush all remaining logs
    await this.pushLogsToServer(
      resolveRunCommandPromise,
      rejectRunCommandPromise,
      true,
    )

    // send the task done event
    this.logFile.write('INFO', `${logTask(this.task)} ran in ${commandRuntimeMillis}ms with return code ${commandReturnCode}`) // prettier-ignore
    this.logFile.write('INFO', `sending task done event`)
    try {
      await this.api.setProjectBuildTaskDone({
        projectBuildId: this.projectBuild.id,
        taskIndex: this.taskIndex,
        commandReturnCode,
        commandRuntimeMillis,
      })
    } catch (err) {
      rejectRunCommandPromise(err)
    }

    // when done, resolve the command as run
    resolveRunCommandPromise({
      commandReturnCode: commandReturnCode,
      commandRuntimeMs: commandRuntimeMillis,
    })
  }
}
