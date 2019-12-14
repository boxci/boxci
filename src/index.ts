import { Command } from 'commander'
import CommandLogger from './CommandLogger'
import { buildApi, ProjectBuild } from './api'
import { printErrorAndExit, LogFile } from './logging'
import spinner, { Spinner } from './Spinner'
import getConfig, { readCommandFromConfigFile, Config } from './config'
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

const runningBuildMessage = (config: Config, projectBuild: ProjectBuild) => {
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

const runBuild = async (
  projectBuild: ProjectBuild,
  cwd: string,
  api: ReturnType<typeof buildApi>,
  logFile: LogFile,
  line: string,
) => {
  // run the command and send logs to the service
  const commandLogger = new CommandLogger(projectBuild, api, cwd, logFile)
  const commandFinishedResult = await commandLogger.whenCommandFinished()

  log(`\n\n${Yellow(line)}`)

  // if the command was stopped because it was cancelled or timed out, log that and return
  if (commandFinishedResult.commandStopped) {
    log(`∙ ${Red(`Build ${commandFinishedResult.commandStopped.cancelled ? 'cancelled' : 'timed out'}`)}\n│`) // prettier-ignore
    log(`∙ Runtime: ${commandFinishedResult.runtimeMs}ms\n│`) // prettier-ignore

    if (commandFinishedResult.commandStopped.timedOut) {
      // prettier-ignore
      log(
        `Note: A build times out after 2 minutes without receiving logs from ${Yellow('boxci')}\n` +
        `This could be due to bad network conditions.\n` +
        `If you are running in ${Yellow('agent')} mode the build will automatically retry\n`)
    }

    return
  }

  const finishSendingLogsSpinner = spinner('Completing build') // prettier-ignore

  const allLogsSentResult = await commandLogger.whenAllLogsSent()

  if (!allLogsSentResult.errors) {
    const successFailureMessage =
      allLogsSentResult.commandReturnCode === 0
        ? Green('✓ Success')
        : Red('✗ Failed')

    finishSendingLogsSpinner.stop(`${successFailureMessage}  ${Yellow('│')}  ${commandFinishedResult.runtimeMs}ms\n${Yellow(line)}\n\n`) // prettier-ignore
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

const getBranchAndCommit = async (
  cliOptions: any,
  createBuildSpinner: Spinner,
  git: Git,
): Promise<{
  commit: string
  branch: string
}> => {
  // check git is installed
  if (!(await git.getVersion())) {
    createBuildSpinner.stop()

    return printErrorAndExit(`${Yellow('git')} not found. Is it installed on this machine?`) // prettier-ignore
  }

  // get current branch so it can be added to the build
  const branch = await git.getBranch()

  if (!branch) {
    createBuildSpinner.stop()

    return printErrorAndExit(`Could not find git branch`)
  }

  // get commit either from passed option, or HEAD of branch otherwise
  let commit

  if (cliOptions.commit) {
    commit = cliOptions.commit

    if (commit.length !== 40) {
      createBuildSpinner.stop()

      // prettier-ignore
      return printErrorAndExit(
        `${Yellow('--commit')} must be a full-length 40 character commit hash\n` +
          (commit.length === 7 ? `not the short hash [${commit}]` : `you provided [${commit}]`),
      )
    }
  } else {
    commit = await git.getCommit()

    if (!commit) {
      createBuildSpinner.stop()

      return printErrorAndExit(`Could not find git commit`)
    }
  }

  return {
    commit,
    branch,
  }
}

const buildLogFilePath = (logsDir: string, projectBuild: ProjectBuild) =>
  `${logsDir}/boxci-build-${projectBuild.id}.log`

// --------- Build Mode ---------
cli
  .command('build')
  .option('-c, --commit <arg>')
  .action(async (cliOptions: any) => {
    const git = new Git()
    printTitle('Running direct build')
    const gettingConfigSpinner = spinner('Preparing build')

    const { commit, branch } = await getBranchAndCommit(
      cliOptions,
      gettingConfigSpinner,
      git,
    )

    const cwd = process.cwd()
    const config = getConfig(cli, cwd, gettingConfigSpinner)
    const { repoDir, logsDir } = await data.prepare(cwd, gettingConfigSpinner)

    // prettier-ignore
    gettingConfigSpinner.stop(
        `∙ Project  ${config.projectId}`)
    log(`∙ Branch   ${branch}`)
    log(`∙ Commit   ${commit}`)
    log('')

    const createStartingBuildSpinner = () => spinner('Starting Build')
    let startingBuildSpinner = createStartingBuildSpinner()
    let logFile

    try {
      const api = buildApi(config)

      const projectBuild = await api.runProjectBuildDirect({
        machineName: config.machineName,
        gitBranch: branch,
        gitCommit: commit,
      })

      startingBuildSpinner.stop('Project Repo')
      log(`  ssh  ${LightBlue(projectBuild.gitRepoSshUrl)}`)
      log(projectBuild.gitRepoLink ? `  web  ${projectBuild.gitRepoLink}` : '')
      log('')
      startingBuildSpinner = createStartingBuildSpinner()

      logFile = new LogFile(
        buildLogFilePath(logsDir, projectBuild),
        'INFO',
        startingBuildSpinner,
      )

      git.setLogFile(logFile)

      // clone the project at the commit specified in the projectBuild into the data dir
      await data.prepareForNewBuild(
        git,
        repoDir,
        projectBuild,
        startingBuildSpinner,
      )

      // the command string comes from config file at the specified commit
      const command = readCommandFromConfigFile(
        repoDir,
        projectBuild.gitCommit,
        startingBuildSpinner,
      )
      // update the command string on the service, and locally, before running the build
      projectBuild.commandString = command
      await api.setProjectBuildCommand({
        projectBuildId: projectBuild.id,
        commandString: command,
      })

      const { message, line } = runningBuildMessage(config, projectBuild)
      startingBuildSpinner.stop(message)
      log(`${Yellow(line)}\n${Yellow(projectBuild.commandString)}\n\n`)

      await runBuild(projectBuild, repoDir, api, logFile, line)
    } catch (err) {
      startingBuildSpinner.stop()

      if (err.isAuthError) {
        // prettier-ignore
        printErrorAndExit(
            `The configured ${Yellow('project')} [${config.projectId}] and ${Yellow('key')} combination is incorrect\n` +
            `  ∙ Check for typos in either\n` +
            `  ∙ Check the ${Yellow('key')} wasn't changed`,
            undefined,
            logFile ? logFile.filePath : undefined
        )
      }

      // prettier-ignore
      printErrorAndExit(
        `Failed to start build\n\n` +
          `Could not communicate with service at ${LightBlue(config.service)}\n\n` +
          `Cause:\n\n${err}\n\n`,
          undefined,
          logFile ? logFile.filePath : undefined
      )
    }
  })

// --------- Agent Mode ---------
cli.command('agent').action(async () => {
  printTitle('Running agent')

  const cwd = process.cwd()
  const config = getConfig(cli, cwd)
  const api = buildApi(config)
  const { repoDir, logsDir } = await data.prepare(cwd)

  // log common config
  log(`∙ Project  ${config.projectId}`)
  if (config.machineName) {
    log(`∙ Machine  ${config.machineName}`)
  }
  log('')

  pollForAndRunAgentBuild(
    repoDir,
    config,
    api,
    startAgentWaitingForBuildSpinner(),
    logsDir,
  )
})

// Poll every 15 seconds for new jobs to run
// TODO make this configurable?
const AGENT_POLL_INTERVAL = 15000

const startAgentWaitingForBuildSpinner = () =>
  spinner(`Listening for build jobs...`)

const pollForAndRunAgentBuild = async (
  repoDir: string,
  config: Config,
  api: ReturnType<typeof buildApi>,
  agentWaitingForBuildSpinner: Spinner,
  logsDir: string,
) => {
  // log('INFO', () => `polling`)
  let projectBuild = await api.runProjectBuildAgent({
    machineName: config.machineName,
  })

  // if a project build is returned, run it
  if (projectBuild) {
    const logFile = new LogFile(buildLogFilePath(logsDir, projectBuild), 'INFO', agentWaitingForBuildSpinner) // prettier-ignore
    const git = new Git(logFile)

    // clone the project at the commit specified in the projectBuild into the data dir
    await data.prepareForNewBuild(
      git,
      repoDir,
      projectBuild,
      agentWaitingForBuildSpinner,
    )

    // the command string comes from config file at the specified commit
    const command = readCommandFromConfigFile(
      repoDir,
      projectBuild.gitCommit,
      agentWaitingForBuildSpinner,
    )
    // update the command string on the service, and locally, before running the build
    projectBuild.commandString = command
    await api.setProjectBuildCommand({
      projectBuildId: projectBuild.id,
      commandString: command,
    })
    // log that the build started, and run it
    const { message, line } = runningBuildMessage(config, projectBuild)

    agentWaitingForBuildSpinner.stop(message)
    log(`${Yellow(line)}\n${Yellow(projectBuild.commandString)}\n\n`)
    await runBuild(projectBuild, repoDir, api, logFile, line)

    // when build finished, show spinner again and wait for new build
    agentWaitingForBuildSpinner = startAgentWaitingForBuildSpinner()
  } else {
    // log('INFO', () => `no build found`)
  }

  // recursively poll again after the interval
  setTimeout(() => {
    pollForAndRunAgentBuild(
      repoDir,
      config,
      api,
      agentWaitingForBuildSpinner,
      logsDir,
    )
  }, AGENT_POLL_INTERVAL)
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
