import api, {
  DEFAULT_RETRIES,
  Project,
  ProjectBuild,
  ProjectBuildPipeline,
  TaskLogs,
} from './api'
import BuildLogger from './BuildLogger'
import {
  AgentConfig,
  ProjectBuildConfig,
  readProjectBuildConfig,
} from './config'
import { Bright, Dim, Green, Red, Yellow } from './consoleFonts'
import { prepareForNewBuild } from './data2'
import git from './git'
import Spinner from './Spinner'
import TaskRunner from './TaskRunner'
import {
  getCurrentTimeStamp,
  millisecondsToHoursMinutesSeconds,
  padStringToLength,
} from './util'

class ServerSyncMetadata {
  public logsSentPointer = 0
  public synced = {
    logs: false,
    taskStarted: false,
    taskDone: false,
  }
}

export default class BuildRunner {
  private projectBuild: ProjectBuild
  private buildLogger: BuildLogger
  private project: Project
  private agentConfig: AgentConfig
  private cwd: string

  private start: number | undefined
  private runtimeMs = 0
  private pipelineReturnCode: number | undefined

  private taskRunners: Array<TaskRunner>
  private serverSyncMetadata: Array<ServerSyncMetadata>

  private synced = false
  private closed = false
  private syncInterval = 5000
  private __syncIntervalReference: NodeJS.Timeout | undefined = undefined
  // a lock for sync() so multiple calls can't be made in parallel
  private __syncLock = false

  private agentMetaDir: string

  constructor({
    agentConfig,
    projectBuild,
    buildLogsDir,
    agentMetaDir,
    cwd,
    project,
  }: {
    agentConfig: AgentConfig
    projectBuild: ProjectBuild
    buildLogsDir: string
    agentMetaDir: string
    cwd: string
    project: Project
  }) {
    this.cwd = cwd
    this.project = project
    this.agentConfig = agentConfig
    this.projectBuild = projectBuild
    this.taskRunners = []
    this.serverSyncMetadata = []
    this.agentMetaDir = agentMetaDir

    this.buildLogger = new BuildLogger({
      projectBuild,
      buildLogsDir,
      logLevel: 'INFO',
    })
  }

  public isSynced(): boolean {
    return this.synced
  }

  // cleans up the logger references after build is synced
  public stopSyncing(): void {
    // don't allow this to run twice
    if (this.closed) {
      return
    }

    this.closed = true
    this.buildLogger.writeEvent('INFO', `Build ${this.projectBuild.id} fully synced with server - stopping sync and closing log file streams`) // prettier-ignore

    // close log file streams, not needed any more
    this.buildLogger.close()

    // stop the build syncing by clearing the interval
    if (this.__syncIntervalReference) {
      clearInterval(this.__syncIntervalReference)
    }
  }

  // syncs the output of the build with the server asynchronously so that
  // streaming the output is decoupled from actually running the build and it can be robust to
  // network errors etc
  public async startSync() {
    // call sync on an interval until all synced
    this.__syncIntervalReference = setInterval(async () => {
      this.sync()
    }, this.syncInterval)
  }

  // does the setup to run the build
  // this won't throw, but if it returns false it means an error happened which
  // means we can't continue to run the build and just need to fail it
  public async prepareBuildAndGetPipeline(): Promise<
    ProjectBuildPipeline | undefined
  > {
    const preparingSpinner = new Spinner(
      {
        type: 'listening',
        text: '\n',
        prefixText: `${PIPE_WITH_INDENT}${Yellow('Preparing build')} `,
        enabled: this.agentConfig.spinnerEnabled,
      },
      // do not show 'reconnecting' on spinner when requests retry
      // the build will just run and any metadata and logs not synced
      // because of connectivity issues etc will just be synced later
      // so there is no need to show that the cli is reconnecting
      undefined,
    )

    preparingSpinner.start()

    // clone the project at the commit specified in the projectBuild into the data dir
    //
    // IMPORTANT this function deals with logging any errors that happen preparing for the build
    // both in the build logs and sending the error to the server. If there is an error, we receive
    // back a consoleErrorMessage that is formatted for printing to the cli output - we stop the spinner
    // and print this, then do not run the build and continue to listen for new builds
    const { consoleErrorMessage, repoDir } = await prepareForNewBuild({
      agentConfig: this.agentConfig,
      projectBuild: this.projectBuild,
      project: this.project,
      buildLogger: this.buildLogger,
      agentMetaDir: this.agentMetaDir,
    })

    // if there was an error, don't run the build
    // but don't exit - just continue and wait for the next build
    if (consoleErrorMessage !== undefined) {
      preparingSpinner.stop(PIPE_WITH_INDENT + Red('Error preparing build') + `\n\n${consoleErrorMessage}\n\n`) // prettier-ignore

      return
    }

    if (!this.projectBuild.gitBranch) {
      this.buildLogger.writeEvent('INFO', `Build ${this.projectBuild.id} does not have a branch set. Will try to infer branch from commit ${this.projectBuild.gitCommit}`) // prettier-ignore
      const gitBranches = await git.getBranchesForCommit({
        commit: this.projectBuild.gitCommit,
        buildLogger: this.buildLogger,
      })
      this.buildLogger.writeEvent('INFO', `Commit ${this.projectBuild.gitCommit} is on these branches: ${gitBranches.join(', ')}`) // prettier-ignore

      // only select a branch if there's only one option
      if (gitBranches.length === 1) {
        const gitBranch = gitBranches[0]
        this.projectBuild.gitBranch = gitBranch

        this.buildLogger.writeEvent('INFO', `Setting build ${this.projectBuild.id} branch as ${gitBranch}`) // prettier-ignore
        try {
          await api.setProjectBuildGitBranch({
            agentConfig: this.agentConfig,
            payload: {
              projectBuildId: this.projectBuild.id,
              gitBranch,
            },
            spinner: preparingSpinner,
            retries: DEFAULT_RETRIES,
          })
          this.buildLogger.writeEvent('INFO', `Set build ${this.projectBuild.id} branch as ${gitBranch}`) // prettier-ignore
        } catch (err) {
          this.buildLogger.writeError(`Could not set build ${this.projectBuild.id} branch as ${gitBranch}`, err) // prettier-ignore
          // just continue if any errors here
          // we can try to continue because not having the branch is fine, it's just a UX feature to have it
        }
      }
    }

    this.buildLogger.writeEvent('INFO', `Reading config for build ${this.projectBuild.id}`) // prettier-ignore

    const {
      projectBuildConfig,
      configFileName,
      validationErrors,
      configFileError,
    } = readProjectBuildConfig({ dir: repoDir })

    if (configFileError !== undefined) {
      this.buildLogger.writeEvent('ERROR', `Could not read config for build ${this.projectBuild.id}. Cause: ${configFileError}`) // prettier-ignore
      preparingSpinner.stop(configFileError)

      return
    }

    if (validationErrors !== undefined) {
      const errorMessage = validationErrors.join('\n')
      this.buildLogger.writeEvent('ERROR', `Errors in config for build ${this.projectBuild.id}:\n${errorMessage}`) // prettier-ignore

      preparingSpinner.stop(
        `\n\n` +
          `Found the following config errors\n` +
          `- build:  ${this.projectBuild.id}\n` +
          `- commit: ${this.projectBuild.gitCommit})\n` +
          `- file:   ${configFileName}\n\n` +
          `${errorMessage}\n\n` +
          `Run ${Yellow('boxci docs')} for more info on config options\n\n`,
      )

      return
    }

    if (projectBuildConfig === undefined) {
      this.buildLogger.writeEvent('ERROR', `Could not read config for build ${this.projectBuild.id}`) // prettier-ignore
      preparingSpinner.stop(
        `\n\n` +
          `Could not read build config\n` +
          `- build:  ${this.projectBuild.id}\n` +
          `- commit: ${this.projectBuild.gitCommit})\n`,
      )

      return
    }

    // reruns of old builds might already have a pipeline set if they got that far
    // if this is the case, no need to find the pipeline again as we already have it
    if (this.projectBuild.pipeline !== undefined) {
      this.buildLogger.writeEvent('INFO', `Pipeline already set on build ${this.projectBuild.id} (it is a rerun of build ${this.projectBuild.rerunId})`) // prettier-ignore

      preparingSpinner.stop()

      return this.projectBuild.pipeline
    }

    this.buildLogger.writeEvent('INFO', `Finding pipeline for build ${this.projectBuild.id} in config`) // prettier-ignore

    // try to match a pipeline in the project build config to the ref for this commit
    const pipeline: ProjectBuildPipeline | undefined = getProjectBuildPipeline(
      this.projectBuild,
      projectBuildConfig,
    )

    // if no pipeline found, we send the build skipped event, show in the cli output, and continue to listen for next build
    if (pipeline === undefined) {
      this.buildLogger.writeEvent(
        'INFO',
        `No pipeline matches ref for build ${this.projectBuild.id} ` +
          `(commit ${this.projectBuild.gitCommit}, ` +
          `branch ${this.projectBuild.gitBranch ?? '[none]'}, ` +
          `tag ${this.projectBuild.gitTag ?? '[none]'})`,
      )

      this.buildLogger.writeEvent(
        'INFO',
        `Setting no pipeline matched on server for build ${this.projectBuild.id}`,
      )

      try {
        await api.setProjectBuildNoMatchingPipeline({
          agentConfig: this.agentConfig,
          payload: {
            projectBuildId: this.projectBuild.id,
          },
          spinner: undefined,
          retries: DEFAULT_RETRIES,
        })
        this.buildLogger.writeEvent('INFO', `Successfully set no pipeline matched on server for build ${this.projectBuild.id}`) // prettier-ignore
      } catch (err) {
        // if any errors happen here, ignore them, build will just time out
        this.buildLogger.writeError(`Could not set no pipeline matched on server for build ${this.projectBuild.id}`, err) // prettier-ignore
      }

      let matchingRef = ''
      if (this.projectBuild.gitTag) {
        matchingRef += `tag [${this.projectBuild.gitTag}]`
      }
      if (this.projectBuild.gitBranch) {
        if (matchingRef) {
          matchingRef += ' or '
        }
        matchingRef += `branch [${this.projectBuild.gitBranch}]`
      }

      preparingSpinner.stop(
        `No pipeline matches ${matchingRef}\nSo no build will run\n` +
            `If this is unexpected, check pipelines in config file${configFileName ? ': ' + Yellow(configFileName) : ''} at commit ${this.projectBuild.gitCommit}\n\n`, // prettier-ignore
      )

      return
    }

    this.buildLogger.writeEvent('INFO', `Matched pipeline [${pipeline.n}] with tasks [${pipeline.t.map(t => t.n).join(', ')}] for build ${this.projectBuild.id} at commit ${this.projectBuild.gitCommit}`) // prettier-ignore

    try {
      await api.setProjectBuildPipeline({
        agentConfig: this.agentConfig,
        payload: {
          projectBuildId: this.projectBuild.id,
          pipeline,
        },
        spinner: undefined,
        retries: DEFAULT_RETRIES,
      })
      this.buildLogger.writeEvent('INFO', `Successfully set pipeline on server for build ${this.projectBuild.id}`) // prettier-ignore
    } catch (err) {
      // if any errors happen here, ignore them and return false, build will just time out
      this.buildLogger.writeError(`Could not set pipleine on server for build ${this.projectBuild.id}`, err) // prettier-ignore

      return
    }

    preparingSpinner.stop()

    return pipeline
  }

  public async run() {
    this.start = getCurrentTimeStamp()

    this.buildLogger.writeEvent('INFO', `Preparing build ${this.projectBuild.id}`) // prettier-ignore
    const pipeline = await this.prepareBuildAndGetPipeline()

    // if no pipeline matched, it means we skip over this build onto the next one
    if (pipeline === undefined) {
      return
    }

    // set pipeline on local projectBuild model, and run the pipeline
    this.projectBuild.pipeline = pipeline

    for (let taskIndex = 0; taskIndex < pipeline.t.length; taskIndex++) {
      this.taskRunners.push(
        new TaskRunner({
          taskIndex,
          projectBuild: this.projectBuild,
          cwd: this.cwd,
          buildLogger: this.buildLogger,
        }),
      )
      this.serverSyncMetadata.push(new ServerSyncMetadata())
    }

    // keep a local model of taskLogs updated with what's being synced with server
    // so that heavy logs responses don't have to be sent back
    this.projectBuild.taskLogs = []

    let commandReturnCodeOfMostRecentTask: number | undefined

    // run all tasks
    for (
      let taskIndex = 0;
      taskIndex < this.projectBuild.pipeline.t.length;
      taskIndex++
    ) {
      const { tasksDoneString, tasksTodoString } = printTasksProgress(this.projectBuild, taskIndex) // prettier-ignore
      const spinner = new Spinner(
        {
          type: 'dots',
          text: tasksTodoString,
          prefixText: tasksDoneString + PIPE_WITH_INDENT,
          enabled: this.agentConfig.spinnerEnabled,
        },
        // do not show 'reconnecting' on spinner when requests retry
        // the build will just run and any metadata and logs not synced
        // because of connectivity issues etc will just be synced later
        // so there is no need to show that the cli is reconnecting
        undefined,
      )

      try {
        spinner.start()

        try {
          await api.setProjectBuildTaskStarted({
            agentConfig: this.agentConfig,
            payload: {
              projectBuildId: this.projectBuild.id,
              taskIndex,
            },
            spinner: undefined,
            retries: DEFAULT_RETRIES,
          })
          this.serverSyncMetadata[taskIndex].synced.taskStarted = true
        } catch (err) {
          // on error because of max retries (or any error actually) just continue - will be synced up later
        }

        const taskRunner = this.taskRunners[taskIndex]

        await taskRunner.run()

        // handle build cancellation explictly - it's a special case because
        // if cancelled, we should just return, don't need to run any more tasks
        // or send events to complete the build
        //
        // TODO - how to ensure that latest logs of what actually run sync up on cancellation?
        if (taskRunner.cancelled) {
          this.projectBuild.cancelled = true // set on local model, used in output
          spinner.stop()
          this.runtimeMs = getCurrentTimeStamp() - this.start
          logBuildCancelled(this.projectBuild, this.runtimeMs, taskRunner)

          return // IMPORTANT - 'return' because we need to exit the build completely, not complete it (note difference with break below in case of task failure)
        }

        // An error running the command is also a special case
        // errors here are errors not *in* the build script itself, which will just
        // be returned with the relevant command failure code, but errors actually
        // *running* the build script, at the level up. Might be things like permissions errors
        // at OS level, etc.
        //
        // When these happen, just report them as a return code 1 and send the error message
        // up to logs, qualified as a boxci error (rather than a build script error)
        //
        // Do this here as opposed to in TaskRunner because this handling is an implementation detail
        // and we may also want to mark out the tasks / builds that failed in this way from others
        if (taskRunner.errorRunningCommand) {
          const task = this.projectBuild.pipeline.t[taskIndex]
          taskRunner.logs +=
            `\n\n---\n\boxci encountered an error running the build\n\n` +
            `  - task:    ${task.n}\n` +
            `  - command: ${task.c}\n\n` +
            `Cause:\n\n${taskRunner.errorRunningCommand}\n\n---\n\n`
          taskRunner.commandReturnCode = 1
        }

        // if we're here, command return code is almost defintely defined
        // if taskRunner is finished it's only undefined in case of cancellation, in which case we've already returned,
        // or in case of an error, in which case we've already set it manually to 1
        // just as a fallback though, in case other cases exist, set it to 1 and fail the build if somehow undefined
        commandReturnCodeOfMostRecentTask = taskRunner.commandReturnCode ?? 1

        // update local model
        this.projectBuild.taskLogs.push({
          r: commandReturnCodeOfMostRecentTask,
          t: taskRunner.runtimeMs ?? 0,
          l: taskRunner.logs,
        })

        try {
          await api.setProjectBuildTaskDone({
            agentConfig: this.agentConfig,
            payload: {
              projectBuildId: this.projectBuild.id,
              taskIndex,
              commandReturnCode: commandReturnCodeOfMostRecentTask,
              commandRuntimeMillis: taskRunner.runtimeMs ?? 0,
            },
            spinner: undefined,
            retries: DEFAULT_RETRIES,
          })
          this.serverSyncMetadata[taskIndex].synced.taskDone = true
        } catch (err) {
          // on error because of max retries (or any error actually) just continue - will be synced up later
        }

        // stop and clear the spinner, it will be replaced by a new one for the next task
        spinner.stop()

        // if a task failed, exit the loop - don't run any more tasks and just complete the build as failed
        if (commandReturnCodeOfMostRecentTask !== 0) {
          break // IMPORTANT - 'break' because we need to exit the loop, but still complete the build (note difference with return above in case of build cancellation)
        }
      } catch (err) {
        // IMPORTANT - TaskRunner is designed to not throw exceptions
        // so if there is an expection here, it's really unexpected, but it's essential that
        // the cli continues listening for builds if there is one.
        //
        // Handle this explictly as a failure case, logging the error to the user,
        // do not continue with this build (so that it times out)
        spinner.stop(
          '\n\nThere was an unexpected error running this build,\n' +
            'so it cannot complete and will time out.\n\n' +
            `Cause:\n\n${err}\n\n` +
            `${Yellow('boxci')} will continue listening for builds.\n\n`,
        )

        this.runtimeMs = getCurrentTimeStamp() - this.start

        return // IMPORTANT - 'return' because we need to exit the build completely, not complete it (note difference with break above in case of task failure)
      }
    }

    // if we're here, it means either build succeeded or finished early because of a task that failed
    // set pipline return code as code of last task that ran
    // guaranteed to be defined - TS can't infer because it doesn't know there's at least 1 run of loop
    this.pipelineReturnCode = commandReturnCodeOfMostRecentTask!

    this.runtimeMs = getCurrentTimeStamp() - this.start

    // finish by logging a report of status of all tasks, and overall build result
    logBuildComplete(this.projectBuild, this.runtimeMs, this.pipelineReturnCode)
  }

  // syncs build & task output with server
  public async sync() {
    // don't run if already running (it's called on a loop by setInterval and calls may take longer than the interval)
    // or if already synced
    if (this.__syncLock || this.synced) {
      return
    }

    this.__syncLock = true
    try {
      for (
        let taskIndex = 0;
        taskIndex < this.projectBuild.pipeline.t.length;
        taskIndex++
      ) {
        const taskRunner = this.taskRunners[taskIndex]
        const serverSyncMetadata = this.serverSyncMetadata[taskIndex]
        const taskStarted = taskRunner.start !== undefined

        if (taskStarted) {
          // --- task started event ---
          if (
            !serverSyncMetadata.synced.taskStarted // if taskStarted event not already sent
          ) {
            // send task started event
            await api.setProjectBuildTaskStarted({
              agentConfig: this.agentConfig,
              payload: {
                projectBuildId: this.projectBuild.id,
                taskIndex,
              },
              spinner: undefined,
              retries: DEFAULT_RETRIES,
            })

            serverSyncMetadata.synced.taskStarted = true
          }
        }

        // --- logs ---
        if (
          !serverSyncMetadata.synced.logs // if logs not fully sent
        ) {
          // send latest logs, if any
          const newLogs = taskRunner.logs.substring(
            serverSyncMetadata.logsSentPointer,
          )

          // hold this value for later use
          // this is an async function and the value of taskRunner.logs might chance in the meantime
          //
          // NOTE, this looks like 1 too many but it is correct.
          // The pointer is to the first character pos of the new diff of logs to send,
          // i.e. always 1 ahead of what is actually sent already
          // For instance it starts at 0 when nothing is sent,
          // but 0 is the index of the first character to be sent
          const newLogsPointerIfSuccessful = taskRunner.logs.length

          // same here, store this now because taskRunner may be updated in the meantime
          const isLastLogsForTask =
            taskRunner.runtimeMs !== undefined ||
            taskRunner.cancelled ||
            taskRunner.errorRunningCommand

          const addLogsRes = await api.addLogs({
            agentConfig: this.agentConfig,
            payload: {
              id: this.projectBuild.id,
              i: taskIndex,
              l: newLogs,
            },
            retries: DEFAULT_RETRIES,
            spinner: undefined,
          })

          // if successful, update pointer
          serverSyncMetadata.logsSentPointer = newLogsPointerIfSuccessful + 0

          // if last logs sent successfully, set the synced flag
          if (isLastLogsForTask) {
            serverSyncMetadata.synced.logs = true
          } else if (addLogsRes && addLogsRes.cancelled) {
            // cancel the task if it's not done yet and the build was cancelled
            taskRunner.cancel()

            this.projectBuild.cancelled = true
          }
        }

        // --- task done event ---
        if (
          serverSyncMetadata.synced.logs && // if logs fully sent
          taskRunner.commandReturnCode !== undefined && // and command finished running
          !serverSyncMetadata.synced.taskDone // and task done not already sent
        ) {
          // sent task done event
          await api.setProjectBuildTaskDone({
            agentConfig: this.agentConfig,
            payload: {
              projectBuildId: this.projectBuild.id,
              taskIndex,
              commandReturnCode: taskRunner.commandReturnCode,
              commandRuntimeMillis: taskRunner.runtimeMs ?? 0,
            },
            spinner: undefined,
            retries: DEFAULT_RETRIES,
          })
          this.serverSyncMetadata[taskIndex].synced.taskDone = true
        }
      }

      // --- after tasks loop has run ---
      let allTasksSynced = true
      for (let task of this.serverSyncMetadata) {
        if (!task.synced.taskDone) {
          allTasksSynced = false
          break
        }
      }

      // if all tasks synced, complete the build, sending the overall pipeline result
      if (allTasksSynced && this.pipelineReturnCode !== undefined) {
        await api.setProjectBuildPipelineDone({
          agentConfig: this.agentConfig,
          payload: {
            projectBuildId: this.projectBuild.id,
            pipelineReturnCode: this.pipelineReturnCode,
            pipelineRuntimeMillis: this.runtimeMs,
          },
          retries: DEFAULT_RETRIES,
          spinner: undefined,
        })
        this.synced = true
      }
    } catch (err) {
      // ignore any errors (due to exceeded max request retries, etc)
      // as sync is running on an interval anyway
    } finally {
      this.__syncLock = false
    }
  }
}

export const PIPE_WITH_INDENT = `${Bright('│')} `
const PIPELINE_PROGRESS_TASK_LIST_ITEM_CHAR = '◦'

// prints strings for done tasks, with statuses,
// and todo tasks (including the one currently running) with no statuses
const printTasksProgress = (
  projectBuild: ProjectBuild,
  taskRunningIndex: number,
) => {
  const paddedTaskNames = getPaddedTaskNames(projectBuild)
  const paddedTaskRuntimes = getPaddedTaskRuntimes(projectBuild)

  let tasksDoneString = ''
  for (let i = 0; i < taskRunningIndex; i++) {
    const taskLogs = projectBuild.taskLogs[i]

    tasksDoneString +=
      PIPE_WITH_INDENT +
      `${printStatusIcon(getDoneTaskStatus(taskLogs))} ` +
      paddedTaskNames[i] +
      `  ${Dim(paddedTaskRuntimes[i])}\n`
  }

  let tasksTodoString = ''
  for (let i = taskRunningIndex; i < paddedTaskNames.length; i++) {
    // for the running task, do not precede with a bullet point.
    // A spinner will be rendered instead
    if (i === taskRunningIndex) {
      tasksTodoString += `${paddedTaskNames[i]}\n`
    } else {
      tasksTodoString +=
        PIPE_WITH_INDENT +
        `${PIPELINE_PROGRESS_TASK_LIST_ITEM_CHAR} ` +
        `${paddedTaskNames[i]}\n`
    }
  }

  return {
    tasksDoneString,
    tasksTodoString,
  }
}

const getPaddedTaskNames = (projectBuild: ProjectBuild) => {
  const tasks = projectBuild.pipeline.t
  const longestTaskName = Math.max(...tasks.map((task) => task.n.length))

  return tasks.map((task) => padStringToLength(task.n, longestTaskName))
}

const getPaddedTaskRuntimes = (projectBuild: ProjectBuild) => {
  let foundFirstTaskThatDidNotComplete = false

  const taskRuntimeStrings = projectBuild.pipeline.t.map((_, index) => {
    const taskLogs = projectBuild.taskLogs[index]

    if (taskLogs?.t) {
      return printRuntime(taskLogs.t)
    }

    if (foundFirstTaskThatDidNotComplete) {
      return '-'
    }

    foundFirstTaskThatDidNotComplete = true

    // if the build cancelled or timed out, display that instead of the blank runtime for the task
    if (projectBuild.cancelled) {
      return 'cancelled'
    }

    if (projectBuild.timedOut) {
      return 'timed out'
    }

    return '-'
  })

  const longestRuntimeString = Math.max(
    ...taskRuntimeStrings.map((runtimeString) => runtimeString.length),
  )

  return taskRuntimeStrings.map((runtimeString) =>
    padStringToLength(runtimeString, longestRuntimeString, true),
  )
}

const printRuntime = (milliseconds: number) => {
  let { hours, minutes, seconds } = millisecondsToHoursMinutesSeconds(
    milliseconds,
  )

  if (hours) {
    const secondsString = seconds < 10 ? `0${seconds}` : `${seconds}`
    const minutesString = minutes < 10 ? `0${minutes}` : `${minutes}`

    return `${hours}h ${minutesString}m ${secondsString}s`
  }

  if (minutes) {
    const secondsString = seconds < 10 ? `0${seconds}` : `${seconds}`

    return `${minutes}m ${secondsString}s`
  }

  return `${seconds}s`
}

const printStatusIcon = (taskStatus: TaskStatus) => {
  switch (taskStatus) {
    case TaskStatus.success:
      return Green('✓')
    case TaskStatus.failed:
      return Red('✗')
    case TaskStatus.cancelled:
    case TaskStatus.timedOut:
    case TaskStatus.didNotRun:
      return Dim(PIPELINE_PROGRESS_TASK_LIST_ITEM_CHAR)
    case TaskStatus.queued:
    case TaskStatus.running:
      // these cases should never happen, just putting them in to satisfy TS
      // that all statuses are dealt with, so we have this assurace if any are added in future
      return ''
    default: {
      const x: never = taskStatus

      return x
    }
  }
}

const getTaskStatuses = (
  projectBuild: ProjectBuild,
  buildCancelled: boolean,
): Array<TaskStatus> => {
  // flags for when we've located the last running task in the case the
  // build is cancelled or timed out - we mark the last running task with
  // that same status, i.e. cancelled or timed out, and the rest after that
  // as didNotRun
  let unfinishedTaskFound = false

  return projectBuild.pipeline.t.map((_, taskIndex) => {
    const taskLogs = projectBuild.taskLogs[taskIndex]

    if (taskLogs === undefined || taskLogs.r === undefined) {
      // if this is the first task we encounter with no return code
      // it must be the task that got cancelled or timed out
      //
      // mark it as such and then any subsequent task with no return node as didNotRun
      //
      // IMPORTANT - this assumes that this function is only called
      // after the build has stopped running. Perhaps put in validation for this
      if (unfinishedTaskFound) {
        return TaskStatus.didNotRun
      } else {
        unfinishedTaskFound = true

        return buildCancelled ? TaskStatus.cancelled : TaskStatus.didNotRun
      }
    }

    // otherwise status is simply success/failed accroding to return code
    return taskLogs.r === 0 ? TaskStatus.success : TaskStatus.failed
  })
}

// prints a task's status in the logs, complete with color etc
const printStatus = (taskStatus: TaskStatus) => {
  switch (taskStatus) {
    case TaskStatus.success:
    case TaskStatus.failed:
    case TaskStatus.didNotRun:
    case TaskStatus.cancelled:
    case TaskStatus.timedOut:
      return ''
    case TaskStatus.queued:
    case TaskStatus.running:
      // these cases should never happen, just putting them in to satisfy TS
      // that all statuses are dealt with, so we have this assurace if any are added in future
      return ''
    default: {
      const x: never = taskStatus

      return x
    }
  }
}

// prints strings for all tasks in the pipeline, including their status if they ran
const printTaskStatusesWhenPipelineDone = (
  projectBuild: ProjectBuild,
  buildCancelled?: boolean,
) => {
  const paddedTaskNames = getPaddedTaskNames(projectBuild)
  const paddedTaskRuntimes = getPaddedTaskRuntimes(projectBuild)
  const taskStatuses = getTaskStatuses(projectBuild, !!buildCancelled)

  let output = PIPE_WITH_INDENT

  paddedTaskNames.forEach((paddedTaskName, taskIndex) => {
    const taskStatus = taskStatuses[taskIndex]
    output +=
      `${printStatusIcon(taskStatus)} ` +
      paddedTaskName +
      printStatus(taskStatus) +
      `  ${Dim(paddedTaskRuntimes[taskIndex])}\n` +
      PIPE_WITH_INDENT
  })

  return output
}

enum TaskStatus {
  running,
  success,
  failed,
  cancelled,
  timedOut,
  queued,
  didNotRun,
}

const getDoneTaskStatus = (taskLogs: TaskLogs) => {
  return taskLogs.r === 0 ? TaskStatus.success : TaskStatus.failed
}

const logBuildCancelled = (
  projectBuild: ProjectBuild,
  runtimeMs: number,
  taskRunner: TaskRunner,
) => {
  console.log(printTaskStatusesWhenPipelineDone(projectBuild, true))
  console.log(`${Bright('│')} Build ${Red('Cancelled')} after ${printRuntime(runtimeMs + (taskRunner.runtimeMs ?? 0))}\n\n`) // prettier-ignore
}

const logBuildComplete = (
  projectBuild: ProjectBuild,
  runtimeMs: number,
  commandReturnCodeOfMostRecentTask: number,
) => {
  console.log(printTaskStatusesWhenPipelineDone(projectBuild))

  const succeeded = commandReturnCodeOfMostRecentTask === 0
  const messageResultText = succeeded ? 'succeeded' : 'failed'
  const messageResultColor = succeeded ? Green : Red

  console.log(`${Bright('│')} Build ${messageResultColor(messageResultText)} in ${printRuntime(runtimeMs)}\n\n`) // prettier-ignore
}

const getProjectBuildPipeline = (
  projectBuild: ProjectBuild,
  projectBuildConfig: ProjectBuildConfig,
): ProjectBuildPipeline | undefined => {
  // if a tag, match on tag, else on branch
  const ref = projectBuild.gitTag || projectBuild.gitBranch

  // iterates over the pipeline keys in definition order
  for (let pipelineName of Object.getOwnPropertyNames(
    projectBuildConfig.pipelines,
  )) {
    if (pipelineMatchesRef(pipelineName, ref)) {
      return buildProjectBuildPipelineFromConfig(
        pipelineName,
        projectBuildConfig,
      )
    }
  }
}

const buildProjectBuildPipelineFromConfig = (
  pipelineName: string,
  projectBuildConfig: ProjectBuildConfig,
) => ({
  n: pipelineName,
  t: projectBuildConfig.pipelines[pipelineName].map((taskName) => ({
    n: taskName,
    c: projectBuildConfig.tasks[taskName],
  })),
})

const pipelineMatchesRef = (pipelineName: string, ref: string) => {
  // This is the special case, catch-all pipeline.
  // Match any ref for this pipeline
  if (pipelineName === '*') {
    return true
  }

  // true if exact match
  if (ref === pipelineName) {
    return true
  }

  // also true if wildcard pattern matches
  const wildcardPos = pipelineName.indexOf('*')

  // if no wildcard, no match
  if (wildcardPos == -1) {
    return false
  }

  // wildcard at start
  if (wildcardPos === 0) {
    return ref.endsWith(pipelineName.substring(1))
  }

  // wildcard at end
  if (wildcardPos == pipelineName.length - 1) {
    return ref.startsWith(pipelineName.substring(0, wildcardPos))
  }

  // wildcard in middle
  return (
    ref.startsWith(pipelineName.substring(0, wildcardPos)) &&
    ref.endsWith(pipelineName.substring(wildcardPos + 1))
  )
}
