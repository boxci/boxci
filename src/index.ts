import { Command } from 'commander'
import TaskRunner from './TaskRunner'
import {
  buildApi,
  ProjectBuild,
  Project,
  ProjectBuildPipeline,
  ProjectBuildTask,
} from './api'
import { printErrorAndExit, LogFile } from './logging'
import spinner, { Spinner } from './Spinner'
import {
  getProjectConfig,
  readProjectBuildConfig,
  ProjectConfig,
  ProjectBuildConfig,
} from './config'
import help from './help'
import {
  Yellow,
  Bright,
  Green,
  Red,
  LightBlue,
  Underline,
} from './consoleFonts'
import { Git } from './git'
import * as data from './data'
import { wait } from './util'

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

const runBuild = async (
  projectBuild: ProjectBuild,
  cwd: string,
  api: ReturnType<typeof buildApi>,
  logFile: LogFile,
  line: string,
) => {
  // this is a counter of how long it takes all tasks to run,
  // we add to it after each task has finished with the runtime
  // of that task, which the task itself is responsible for measuring
  let tasksCumulativeRuntimeMs = 0

  // for each task, run the task
  for (
    let taskIndex = 0;
    taskIndex < projectBuild.pipeline.tasks.length;
    taskIndex++
  ) {
    const task = projectBuild.pipeline.tasks[taskIndex]

    // run the task command and send logs to the service
    const taskRunner = new TaskRunner(
      projectBuild,
      taskIndex,
      api,
      cwd,
      logFile,
    )
    const taskCommandResult = await taskRunner.whenCommandFinished()
    tasksCumulativeRuntimeMs += taskCommandResult.runtimeMs

    log(`\n\n${Yellow(line)}`)

    // if the command was stopped because it was cancelled or timed out, log that and return
    if (taskCommandResult.commandStopped) {
      log(`∙ ${Red(`Build ${taskCommandResult.commandStopped.cancelled ? 'cancelled' : 'timed out'}`)}\n│`) // prettier-ignore
      log(`∙ Runtime: ${tasksCumulativeRuntimeMs}ms\n│`) // prettier-ignore

      if (taskCommandResult.commandStopped.timedOut) {
        log(
          `Note: A build times out after 1 minute without ` +
            `receiving logs from ${Yellow('boxci')}\n` +
            `This could be due to bad network conditions.\n`,
        )
      }

      return
    }

    const finishSendingLogsSpinner = spinner('Completing build') // prettier-ignore

    const allLogsSentResult = await taskRunner.whenAllLogsSent()

    if (!allLogsSentResult.errors) {
      const successFailureMessage =
        allLogsSentResult.commandReturnCode === 0
          ? Green('✓ Success')
          : Red('✗ Failed')

      finishSendingLogsSpinner.stop(`${successFailureMessage}  ${Yellow('│')}  ${taskCommandResult.runtimeMs}ms\n${Yellow(line)}\n\n`) // prettier-ignore
    } else {
      const numberOfErrors =
        allLogsSentResult.sendChunkErrors!.length +
        (allLogsSentResult.doneEventError ? 1 : 0)
      finishSendingLogsSpinner.stop(`∙ Failed to send all logs - ${numberOfErrors} failed requests:\n\n`) // prettier-ignore
      let errorCount = 1
      if (allLogsSentResult.doneEventError) {
        log(`[${errorCount++}]  The 'done' event failed to send, cause:\n    ${errorCount < 10 ? ' ' : ''}- ${allLogsSentResult.doneEventError}\n`) // prettier-ignore
      }

      for (let error of allLogsSentResult.sendChunkErrors!) {
        log(`[${errorCount++}]  Error sending a log chunk, cause:\n    ${errorCount < 10 ? ' ' : ''}- ${error}\n`) // prettier-ignore
      }
    }
  }
}

const buildLogFilePath = (logsDir: string, projectBuild: ProjectBuild) =>
  `${logsDir}/boxci-build-${projectBuild.id}.log`

// --------- Run an agent ---------
cli.command('agent').action(async () => {
  printTitle('Running agent')

  const cwd = process.cwd()

  // get the project level config, which does not change commit to commit,
  // at the start and keep it the same for the entire lifetime of the agent
  const projectConfig = getProjectConfig(cli, cwd)

  const api = buildApi(projectConfig)
  const { repoDir, logsDir } = await data.prepare(cwd)

  // log common config
  log(`∙ Project  ${projectConfig.projectId}`)
  if (projectConfig.machineName) {
    log(`∙ Machine  ${projectConfig.machineName}`)
  }
  log('')

  const project = await api.getProject()

  const agentWaitingForBuildSpinner = spinner(`Listening for build jobs...`)

  // poll for project builds until command exited
  while (true) {
    let projectBuild = await api.runProjectBuildAgent({
      machineName: projectConfig.machineName,
    })

    // if a project build is picked from the queue, run it
    if (projectBuild) {
      const logFile = new LogFile(buildLogFilePath(logsDir, projectBuild), 'INFO', agentWaitingForBuildSpinner) // prettier-ignore
      const git = new Git(logFile)

      // clone the project at the commit specified in the projectBuild into the data dir
      await data.prepareForNewBuild(
        git,
        repoDir,
        project,
        projectBuild,
        agentWaitingForBuildSpinner,
      )

      // read the project build level config, which may change commit to commit
      // unlike the projectConfig, at the start of every build from the files pulled
      // from the builds commit
      const projectBuildConfig = readProjectBuildConfig(
        repoDir,
        projectBuild.gitCommit,
        agentWaitingForBuildSpinner,
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

        // log that the build started, and run it
        const { message, line } = runningBuildMessage(
          projectConfig,
          projectBuild,
        )

        agentWaitingForBuildSpinner.stop(message)
        log(`${Yellow(line)}\n\n`)

        await runBuild(projectBuild, repoDir, api, logFile, line)

        // when build finished, show spinner again and wait for new build
        agentWaitingForBuildSpinner.restart()
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
      await wait(15000)
    }
  }
})

const buildProjectBuildPipelineFromConfig = (
  pipelineName: string,
  projectBuildConfig: ProjectBuildConfig,
) => ({
  name: pipelineName,
  tasks: projectBuildConfig.pipelines[pipelineName].map((taskName) => ({
    name: taskName,
    command: projectBuildConfig.tasks[taskName],
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

const runningBuildMessage = (
  config: ProjectConfig,
  projectBuild: ProjectBuild,
) => {
  const buildLink = `${config.service}/p/${config.projectId}/${projectBuild.id}` // prettier-ignore

  const messagePrefix = `Build `
  const message = messagePrefix + LightBlue(buildLink)
  const line = lineOfLength(messagePrefix.length + buildLink.length)

  return {
    message,
    line,
  }
}

const lineOfLength = (length: number) => {
  let line = ''

  for (let i = 0; i < length; i++) {
    line += '─'
  }

  return line
}

const printTitle = (type: string) => {
  const title = 'Box CI'
  const version = `v${VERSION}`
  const space = '   '
  const line = lineOfLength((title + space + version).length)
  const titleString = `${Bright(title)}${space}${version}`

  log('')
  log(LightBlue(line))
  log(titleString)
  log(LightBlue(line))
  log('')
  log(Yellow(type))
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
