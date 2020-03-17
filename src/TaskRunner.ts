import { exec } from 'child_process'
import Logger from './Logger'
import { getCurrentTimeStamp, wait } from './util'
import { ProjectBuild, ProjectBuildTask } from './api'

// TODO this is how to get line numbers from the string
//
// this[logType].split(NEWLINES_REGEX).length - 1,
// const NEWLINES_REGEX: RegExp = /\r\n|\r|\n/

const logTask = (task: ProjectBuildTask) =>
  `task [ ${task.n} ] with command [ ${task.c} ]`

export default class TaskRunner {
  private projectBuild: ProjectBuild
  private taskIndex: number
  private task: ProjectBuildTask
  private cwd: string
  private logger: Logger

  private command: ReturnType<typeof exec> | undefined

  // in-memory model for task metadata and logs
  // will be synced with server eventually by BuildRunner
  public stdoutLogs = ''
  public stderrLogs = ''
  public logs = ''
  public start: number | undefined
  public commandReturnCode: number | undefined
  public runtimeMs: number = 0
  public cancelled = false
  public errorRunningCommand: Error | undefined

  constructor({
    projectBuild,
    taskIndex,
    cwd,
    logger,
  }: {
    projectBuild: ProjectBuild
    taskIndex: number
    cwd: string
    logger: Logger
  }) {
    this.projectBuild = projectBuild
    this.taskIndex = taskIndex
    this.task = projectBuild.pipeline.t[taskIndex]
    this.cwd = cwd
    this.logger = logger
  }

  public run(): Promise<void> {
    return new Promise((resolve) => {
      this.start = getCurrentTimeStamp()
      // wrap resolve to guarantee this.runtimeMs is always when Promise resolves
      // NOTE no reject, instead of throwing an exception here we just set the error and resolve

      this.runWorker(() => {
        this.runtimeMs = getCurrentTimeStamp() - this.start!

        resolve()
      })
    })
  }

  public cancel() {
    // only allow cancellation if the command didn't already run
    if (this.runtimeMs === undefined) {
      // send SIGHUP to command(s)
      // this will kill all command(s) being run even if they are chained together with semicolons
      //
      // this will also fire the 'close' event on command and cause run() to resolve
      this.command?.kill('SIGHUP')
      this.cancelled = true
    }
  }

  private runWorker(completeTask: () => void) {
    try {
      this.command = exec(this.task.c, {
        cwd: this.cwd, // sets child process cwd to where cli is run from, not where cli script is
        env: {
          ...process.env,

          BOXCI_PROJECT: this.projectBuild.projectId,
          BOXCI_PROJECT_BUILD_ID: this.projectBuild.id,
          BOXCI_TASK_INDEX: this.task.n,
          BOXCI_TASK_NAME: this.task.n,
          BOXCI_TASK_COMMAND: this.task.c,

          BOXCI_COMMIT: this.projectBuild.gitCommit,
          BOXCI_COMMIT_SHORT: this.projectBuild.gitCommit?.substr(0, 7),
          BOXCI_BRANCH: this.projectBuild.gitBranch,

          BOXCI_AGENT_NAME: this.projectBuild.agentName,

          // these are vars that might be missing
          // just don't pass them rather than passing as undefined
          ...(this.projectBuild.gitTag && {
            BOXCI_TAG: this.projectBuild.gitTag,
          }),
        },
      })

      // this should never happen, but just in case.. throw with custom error if exec itself undefined
      // it'll be handled just as any other exception in the catch block below
      if (!this.command) {
        throw new Error('Could not execute command')
      }

      // this.logFile.write('INFO', `Running ${logTask(this.task)} - build id: [ ${this.projectBuild.id} ]`) // prettier-ignore

      // handle stdout logs
      if (this.command.stdout) {
        this.command.stdout.on('data', (newLogs) => {
          // this.logFile.write('INFO', `stdout chunk: ${chunk}`)
          this.stdoutLogs += newLogs
          this.logs += newLogs
        })
        // this.logFile.write('DEBUG', `Listening to stdout for ${logTask(this.task)}`) // prettier-ignore
      }
      // } else {
      //   this.logFile.write('DEBUG', `No stdout available for ${logTask(this.task)}`) // prettier-ignore
      // }

      // handle stderr logs
      if (this.command.stderr) {
        this.command.stderr.on('data', (newLogs) => {
          // this.logFile.write('INFO', `stderr chunk: ${chunk}`)
          this.stderrLogs += newLogs
          this.logs += newLogs
        })
        // this.logFile.write('DEBUG', `Listening to stderr for ${logTask(this.task)}`) // prettier-ignore
      }
      // } else {
      //   this.logFile.write('DEBUG', `No stderr available for ${logTask(this.task)}`) // prettier-ignore
      // }

      // handle when the command finishes
      this.command.on('close', (code: number) => {
        // check code is defined / not null and a number
        // if build cancelled & proc killed w/ SIGHUP, close event also fires w/ code === undefined
        if (code !== undefined && code !== null && typeof code === 'number') {
          this.commandReturnCode = code
        }

        completeTask()
      })

      // route any errors from child process to catch block by rethrowing
      this.command.on('error', (err: any) => {
        throw err
      })
    } catch (err) {
      this.errorRunningCommand = err

      completeTask()
    }
  }
}
