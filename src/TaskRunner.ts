import { spawn } from 'child_process'
import BuildLogger from './BuildLogger'
import { getCurrentTimeStamp } from './util'
import { ProjectBuild, ProjectBuildTask } from './api'

// TODO this is how to get line numbers from the string
//
// this[logType].split(NEWLINES_REGEX).length - 1,
// const NEWLINES_REGEX: RegExp = /\r\n|\r|\n/

export default class TaskRunner {
  private projectBuild: ProjectBuild
  private taskIndex: number
  public task: ProjectBuildTask
  private cwd: string
  private logger: BuildLogger

  private command: ReturnType<typeof spawn> | undefined

  // in-memory model for task metadata and logs
  // will be synced with server eventually by BuildRunner
  public stdoutLogs = ''
  public stderrLogs = ''
  public logs = ''
  public start: number | undefined
  public commandReturnCode: number | undefined
  public runtimeMs: number | undefined
  public cancelled = false
  public errorRunningCommand: Error | undefined

  constructor({
    projectBuild,
    taskIndex,
    cwd,
    buildLogger: logger,
  }: {
    projectBuild: ProjectBuild
    taskIndex: number
    cwd: string
    buildLogger: BuildLogger
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

        this.logger.writeEvent('INFO', `Completed ${this.printTaskForLogs()} - return code ${this.commandReturnCode} - runtime ${this.runtimeMs}ms`) // prettier-ignore

        resolve()
      })
    })
  }

  public cancel() {
    // only allow cancellation if the command didn't already finish
    if (this.runtimeMs === undefined) {
      if (this.command !== undefined) {
        const PGID = this.command.pid + 0
        // kill the command and any processes it has spawned by using its process group id
        this.logger.writeEvent('INFO', `Cancelling build - kill all processes with PGID ${PGID}`) // prettier-ignore
        process.kill(-PGID) // the - sign here is required
        this.logger.writeEvent('INFO', `Cancelled build - killed all processes with PGID ${PGID}`) // prettier-ignore
      }

      this.cancelled = true
    }
  }

  private printTaskForLogs(): string {
    return `build [ ${this.projectBuild.id} ] task [ ${this.task.n} ] (${this.taskIndex + 1} of ${this.projectBuild.pipeline.t.length}) command [ ${this.task.c} ]` // prettier-ignore
  }

  private runWorker(completeTask: () => void) {
    try {
      this.logger.writeTaskStart(this.task, this.taskIndex === 0)
      this.logger.writeEvent('INFO', `Running ${this.printTaskForLogs()}`) // prettier-ignore

      this.command = spawn(this.task.c, {
        // runs the command inside a shell, so that the raw command string in this.task.c can be interpreted without
        // having to parse the arguments into an array - uses sh on Unix, process.env.ComSpec on Windows
        shell: true,

        // makes the process the leader of a process group on Unix so we can kill
        // all processes started by the command by using the process group id,
        // which will be the same as the process id for the initial command
        detached: true,

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
        this.logger.writeEvent('ERROR', `Could not run ${this.printTaskForLogs()}}`) // prettier-ignore
        throw new Error('Could not execute command')
      } else {
        this.logger.writeEvent('INFO', `Started command for ${this.printTaskForLogs()}`) // prettier-ignore
      }

      // handle stdout logs
      if (this.command.stdout) {
        this.command.stdout.on('data', (newLogs) => {
          this.stdoutLogs += newLogs
          this.logs += newLogs
          this.logger.writeLogs(newLogs)
        })
      } else {
        this.logger.writeEvent('INFO', `No stdout stream available for ${this.printTaskForLogs()}`) // prettier-ignore
      }

      // handle stderr logs
      if (this.command.stderr) {
        this.command.stderr.on('data', (newLogs) => {
          // this.logFile.write('INFO', `stderr chunk: ${chunk}`)
          this.stderrLogs += newLogs
          this.logs += newLogs
          this.logger.writeLogs(newLogs)
        })
        // this.logFile.write('DEBUG', `Listening to stderr for ${logTask(this.task)}`) // prettier-ignore
      } else {
        this.logger.writeEvent('INFO', `No stderr stream available for ${this.printTaskForLogs()}`) // prettier-ignore
      }

      // handle when the command finishes
      this.command.on('close', (code: number) => {
        this.logger.writeEvent('INFO', `Received close event for ${this.printTaskForLogs()} - return code is ${code ?? 'undefined'}`) // prettier-ignore
        // check code is defined / not null and a number
        // if build cancelled & proc killed w/ SIGHUP, close event also fires w/ code === undefined
        if (code !== undefined && code !== null && typeof code === 'number') {
          this.commandReturnCode = code
        }

        completeTask()
      })

      // route any errors from child process to catch block by rethrowing
      this.command.on('error', (err: Error) => {
        this.logger.writeEvent('ERROR', `Received error event for ${this.printTaskForLogs()}`) // prettier-ignore

        throw err
      })
    } catch (err) {
      this.logger.writeError(`Error thrown running ${this.printTaskForLogs()}`, err) // prettier-ignore
      this.errorRunningCommand = err

      completeTask()
    }
  }
}
