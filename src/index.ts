import { Command } from 'commander'
import { buildApi, ProjectBuild, ProjectBuildPipeline, TaskLogs } from './api'
import {
  getProjectConfig,
  ProjectBuildConfig,
  readProjectBuildConfig,
  ProjectConfig,
} from './config'
import { Bright, Green, LightBlue, Red, Yellow, Dim } from './consoleFonts'
import * as data from './data'
import { Git } from './git'
import help from './help'
import { LogFile } from './logging'
import spinner from './Spinner'
import TaskRunner from './TaskRunner'
import {
  padStringToLength,
  spaces,
  wait,
  millisecondsToHoursMinutesSeconds,
} from './util'

const log = (...args: any) => {
  console.log(...args)
}

const VERSION: string = process.env.NPM_VERSION as string
const cli = new Command()

cli
  .version(VERSION)
  .option('-m, --machine <arg>')
  .option('-r, --retries <arg>')
  .option('-s, --service <arg>')

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

const getTaskStatuses = (
  projectBuild: ProjectBuild,
  buildCancelled: boolean,

  // for now just assume if not cancelled, build timed out if not all tasks have return codes
  // so not using this, but pass it in so that can validate this in future in necessary,
  // if there are more than 2 options for why tasks did not finish
  buildTimedOut: boolean,
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

        return buildCancelled ? TaskStatus.cancelled : TaskStatus.timedOut
      }
    }

    // otherwsie status is simply success/failed accroding to return code
    return taskLogs.r === 0 ? TaskStatus.success : TaskStatus.failed
  })
}

const PIPELINE_PROGRESS_TASK_INDENT = 2
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
      spaces(PIPELINE_PROGRESS_TASK_INDENT) +
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
        spaces(PIPELINE_PROGRESS_TASK_INDENT) +
        `${PIPELINE_PROGRESS_TASK_LIST_ITEM_CHAR} ` +
        `${paddedTaskNames[i]}\n`
    }
  }

  return {
    tasksDoneString,
    tasksTodoString,
  }
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

// prints strings for all tasks in the pipeline, including their status if they ran
const printTaskStatusesWhenPipelineDone = (
  projectBuild: ProjectBuild,
  buildCancelled?: boolean,
  buildTimedOut?: boolean,
) => {
  const paddedTaskNames = getPaddedTaskNames(projectBuild)
  const paddedTaskRuntimes = getPaddedTaskRuntimes(projectBuild)
  const taskStatuses = getTaskStatuses(
    projectBuild,
    !!buildCancelled,
    !!buildTimedOut,
  )

  let output = ''

  paddedTaskNames.forEach((paddedTaskName, taskIndex) => {
    const taskStatus = taskStatuses[taskIndex]
    output +=
      spaces(PIPELINE_PROGRESS_TASK_INDENT) +
      `${printStatusIcon(taskStatus)} ` +
      paddedTaskName +
      printStatus(taskStatus) +
      `  ${Dim(paddedTaskRuntimes[taskIndex])}\n`
  })

  return output
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

const runBuild = async (
  projectBuild: ProjectBuild,
  cwd: string,
  api: ReturnType<typeof buildApi>,
  logFile: LogFile,
) => {
  // this is a counter of how long it takes all tasks to run,
  // we add to it after each task has finished with the runtime
  // of that task, which the task itself is responsible for measuring
  let tasksCumulativeRuntimeMs = 0

  // initialise the taskLogs object
  // we'll manually add to this as tasks run on the client,
  // to keep in sync with what's being sent to the server
  projectBuild.taskLogs = []

  let commandReturnCodeOfMostRecentTask

  // run each task
  for (
    let taskIndex = 0;
    taskIndex < projectBuild.pipeline.t.length;
    taskIndex++
  ) {
    // show tasks progress, with spinner for running task
    const { tasksDoneString, tasksTodoString } = printTasksProgress(
      projectBuild,
      taskIndex,
    )
    const tasksProgressSpinner = spinner(
      tasksTodoString,
      'dots',
      (tasksDoneString || '') + spaces(PIPELINE_PROGRESS_TASK_INDENT), // prettier-ignore
    )

    // run the task command and send logs to the service
    const taskRunner = new TaskRunner(
      projectBuild,
      taskIndex,
      api,
      cwd,
      logFile,
    )
    const taskResult = await taskRunner.done()

    tasksCumulativeRuntimeMs += taskResult.commandRuntimeMs

    // if the command was stopped because it was cancelled or timed out, log that and return
    if (taskResult.cancelled || taskResult.timedOut) {
      // set these locally on the build, so they can be used in log output
      projectBuild.cancelled = taskResult.cancelled
      projectBuild.timedOut = taskResult.timedOut

      tasksProgressSpinner.stop()

      log(
        printTaskStatusesWhenPipelineDone(
          projectBuild,
          taskResult.cancelled,
          taskResult.timedOut,
        ),
      )

      const messageStart = 'Build '
      const reason = taskResult.cancelled ? 'Cancelled' : 'Timed out'
      const messageEnd = ` after ${printRuntime(tasksCumulativeRuntimeMs)}`
      const line = lineOfLength(
        messageStart.length + reason.length + messageEnd.length,
      )
      let message = `${Red(`Build ${reason}`)} after ${printRuntime(tasksCumulativeRuntimeMs)}\n${line}\n` // prettier-ignore
      if (taskResult.timedOut) {
        message +=
          '\n\n' +
          Dim(
            'Note: Timeout occurs after 1 minute of the cli not being able to contact the service.\n',
          )
      }
      message += '\n'
      log(message)

      return
    }

    commandReturnCodeOfMostRecentTask = taskResult.commandReturnCode

    // manually update the projectBuild object's taskLogs to mirror what will be on server
    projectBuild.taskLogs.push({
      r: commandReturnCodeOfMostRecentTask,
      t: taskResult.commandRuntimeMs,
      l: '', // for now not using logs, no point in keeping them in memory for no reason
    })

    // stop and clear the spinner, it will be replaced by a new one for the next task
    tasksProgressSpinner.stop()

    // if a task failed, do not run any subsequent tasks
    if (commandReturnCodeOfMostRecentTask !== 0) {
      break
    }
  }

  // finish by logging a report of status of all tasks, and overall build result
  log(printTaskStatusesWhenPipelineDone(projectBuild))
  const lastTaskResult =
    projectBuild.taskLogs[projectBuild.taskLogs.length - 1].r
  const succeeded = lastTaskResult === 0
  const messageResultText = succeeded ? 'Build succeeded' : 'Build failed'
  const messageResultColor = succeeded ? Green : Red
  const messageRuntimeText = ` in ${printRuntime(tasksCumulativeRuntimeMs)}`
  const endOfBuildOutputLine = lineOfLength(
    messageResultText.length + messageRuntimeText.length,
  )

  log(
    messageResultColor(messageResultText) +
      messageRuntimeText +
      '\n' +
      endOfBuildOutputLine +
      '\n\n',
  )

  // complete the build, sending the overall pipeline result
  // i.e. the return code of last task run, which is used as the overall pipeline
  // return code, so success if all tasks succeeded otherwise the same failure code
  // as the task that failed, and the cumulative runtime of all the tasks
  if (commandReturnCodeOfMostRecentTask) {
    await api.setProjectBuildPipelineDone({
      projectBuildId: projectBuild.id,
      pipelineReturnCode: commandReturnCodeOfMostRecentTask,
      pipelineRuntimeMillis: tasksCumulativeRuntimeMs,
    })
  }
}

const buildLogFilePath = (logsDir: string, projectBuild: ProjectBuild) =>
  `${logsDir}/boxci-build-${projectBuild.id}.log`

const printProjectConfig = (projectConfig: ProjectConfig) =>
  `${Bright('Agent')}      ${projectConfig.agentName}\n` +
  `${Bright('Project')}    ${projectConfig.projectId}\n`

const printProjectBuild = (
  projectConfig: ProjectConfig,
  projectBuild: ProjectBuild,
) =>
  // prettier-ignore
  `${Bright('Build')}      ${projectBuild.id}\n` +
  `${Bright('Commit')}     ${projectBuild.gitCommit}\n` +
  (projectBuild.gitTag ?
  `${Bright('Tag')}        ${projectBuild.gitTag}\n` : '') +
  `${Bright('Branch')}     ${projectBuild.gitBranch}\n` +
  `${Bright('Link')}       ${LightBlue(`${projectConfig.service}/p/${projectConfig.projectId}/${projectBuild.id}`)}\n`

// time to wait between polling for builds
const BUILD_POLLING_INTERVAL = 10000

cli.command('agent').action(async () => {
  printTitle()

  const cwd = process.cwd()

  // get the project level config, which does not change commit to commit,
  // at the start and keep it the same for the entire lifetime of the agent
  const projectConfig = getProjectConfig(cli, cwd)

  const api = buildApi(projectConfig)
  const { repoDir, logsDir } = await data.prepare(cwd)

  const printedProjectConfig = printProjectConfig(projectConfig)
  const waitingForBuildSpinner = spinner(
    `\n\n`,
    'listening',
    // print a newline after the project config for the spinner
    printedProjectConfig + `\n\n${Green('Waiting for builds')} `,
  )

  const project = await api.getProject()

  // poll for project builds until command exited
  while (true) {
    let projectBuild
    try {
      projectBuild = await api.runProjectBuildAgent({
        agentName: projectConfig.agentName,
      })
    } catch (err) {
      // if an error polling for builds, like server not available,
      // just log this and fall through - if no project build defined nothing will happen and
      // cli will try again after interval
      //
      // TODO log this in log file
    }

    // if a project build is picked from the queue, run it
    if (projectBuild) {
      const logFile = new LogFile(buildLogFilePath(logsDir, projectBuild), 'INFO', waitingForBuildSpinner) // prettier-ignore
      const git = new Git(logFile)

      // clone the project at the commit specified in the projectBuild into the data dir
      await data.prepareForNewBuild(
        git,
        repoDir,
        project,
        projectBuild,
        waitingForBuildSpinner,
      )

      // read the project build level config, which may change commit to commit
      // unlike the projectConfig, at the start of every build from the files pulled
      // from the builds commit
      const projectBuildConfig = readProjectBuildConfig(
        repoDir,
        projectBuild.gitCommit,
        waitingForBuildSpinner,
      )

      // try to match a pipeline in the project build config to the ref for this commit
      const pipeline:
        | ProjectBuildPipeline
        | undefined = getProjectBuildPipeline(projectBuild, projectBuildConfig)

      // if a matching pipeline found, run it
      if (pipeline) {
        projectBuild.pipeline = pipeline
        await api.setProjectBuildPipeline({
          projectBuildId: projectBuild.id,
          pipeline,
        })

        waitingForBuildSpinner.stop(
          printedProjectConfig + printProjectBuild(projectConfig, projectBuild),
        )

        await runBuild(projectBuild, repoDir, api, logFile)

        // when build finished, show spinner again and wait for new build
        waitingForBuildSpinner.restart()
      }
      // if no matching pipeline found, cancel the build
      else {
        await api.setProjectBuildNoMatchingPipeline({
          projectBuildId: projectBuild.id,
        })
      }
    } else {
      // if no build is ready to be run this time,
      // wait for the interval time before polling again
      await wait(BUILD_POLLING_INTERVAL)
    }
  }
})

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

const lineOfLength = (length: number) => {
  let line = ''

  for (let i = 0; i < length; i++) {
    line += '─'
  }

  return line
}

const printTitle = () => {
  const title = 'Box CI agent'
  const version = `v${VERSION}`
  const space = '   '
  const line = lineOfLength((title + space + version).length)
  const titleString = `${Bright(title)}${space}${version}`

  log('')
  log(LightBlue(line))
  log(titleString)
  log(LightBlue(line))
  log('')

  return line
}

// override -h, --help default behaviour from commanderjs
// use the custom help messaging defined in ./help.ts
if (
  process.argv.indexOf('-h') !== -1 ||
  process.argv.indexOf('--help') !== -1
) {
  cli.help(help.short)
}

cli.parse(process.argv)

// if no args passed, display help message
if (cli.args.length === 0) {
  cli.help(help.short)
}
