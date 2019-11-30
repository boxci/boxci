import { Command } from 'commander'
import CommandLogger from './CommandLogger'
import { buildApi, ProjectBuild } from './api'
import { printErrorAndExit, LogFile } from './logging'
import spinner, { Spinner } from './Spinner'
import getConfig, { Config } from './config'
import help from './help'
import {
  Yellow,
  Bright,
  Green,
  Red,
  Underline,
  LightBlue,
  Dim,
} from './consoleFonts'
import * as git from './git'
import * as data from './data'
import { gitCommitShort } from './util'

const VERSION: string = process.env.NPM_VERSION as string
const cli = new Command()

cli
  .version(VERSION)
  .option('-m, --machine <arg>')
  .option('-r, --retries <arg>')
  .option('-s, --service <arg>')

const runningBuildMessage = (config: Config, projectBuild: ProjectBuild) => {
  const buildLink = `${config.service}/project/${config.projectId}/build/${projectBuild.id}` // prettier-ignore

  return `Running build ${LightBlue(Underline(buildLink))}\n` // prettier-ignore
}

const printTitle = (directBuild: boolean) => {
  console.log(`\n${Bright('∙ Box CI' + (directBuild ? '' : ' Agent'))}   v${VERSION}\n`) // prettier-ignore
}

const runBuild = async (
  buildType: 'direct' | 'agent',
  projectBuild: ProjectBuild,
  cwd: string,
  api: ReturnType<typeof buildApi>,
  logFile: LogFile,
) => {
  console.log(`∙ Project  ${projectBuild.projectId}`) // prettier-ignore
  console.log(`∙ Branch   ${projectBuild.gitBranch}`)
  console.log(`∙ Commit   ${gitCommitShort(projectBuild.gitCommit)}`) // prettier-ignore
  console.log(`\n\n${Yellow(projectBuild.commandString)}\n\n`)

  // run the command and send logs to the service
  const commandLogger = new CommandLogger(projectBuild, api, cwd, logFile)
  const commandFinishedResult = await commandLogger.whenCommandFinished()

  console.log('\n\n')

  // if the command was stopped because it was cancelled or timed out, log that and return
  if (commandFinishedResult.commandStopped) {
    console.log(`∙ ${Red(`Build ${commandFinishedResult.commandStopped.cancelled ? 'cancelled' : 'timed out'}`)}\n│`) // prettier-ignore
    console.log(`∙ Runtime: ${commandFinishedResult.runtimeMs}ms\n│`) // prettier-ignore

    if (commandFinishedResult.commandStopped.timedOut) {
      // prettier-ignore
      console.log(
        `Note: A build times out after 2 minutes without receiving logs from ${Yellow('boxci')}\n` +
        `This could be due to bad network conditions.\n` +
        `If you are running in ${Yellow('agent')} mode the build will automatically retry\n`)
    }

    return
  }

  const finishSendingLogsSpinner = spinner('Build command finished. Completing build.') // prettier-ignore

  const allLogsSentResult = await commandLogger.whenAllLogsSent()

  if (!allLogsSentResult.errors) {
    finishSendingLogsSpinner.stop(`∙ Runtime ${commandFinishedResult.runtimeMs}ms\n`) // prettier-ignore
    console.log(`${allLogsSentResult.commandReturnCode === 0 ? Green('✓ Build succeeded') : Red('✗ Build failed')}\n\n\n`) // prettier-ignore

    if (buildType === 'agent') {
      console.log(`${Dim('─────')}\n\n\n`)
    }
  } else {
    const numberOfErrors =
      allLogsSentResult.sendChunkErrors!.length +
      (allLogsSentResult.doneEventError ? 1 : 0)
    finishSendingLogsSpinner.stop(`∙ Failed to send all logs - ${numberOfErrors} failed requests:\n\n`) // prettier-ignore
    let errorCount = 1
    if (allLogsSentResult.doneEventError) {
      console.log(`[${errorCount++}]  The 'done' event failed to send, cause:\n    ${errorCount < 10 ? ' ' : ''}- ${allLogsSentResult.doneEventError}\n`) // prettier-ignore
    }

    for (let error of allLogsSentResult.sendChunkErrors!) {
      console.log(`[${errorCount++}]  Error sending a log chunk, cause:\n    ${errorCount < 10 ? ' ' : ''}- ${error}\n`) // prettier-ignore
    }
  }
}

const getProjectBuildConfigForBuildMode = async (
  cliOptions: any,
  createBuildSpinner: Spinner,
): Promise<{
  repoUrl: string
  repoRootDir: string
  commit: string
  branch: string
}> => {
  // check git is installed
  if (!(await git.getVersion())) {
    createBuildSpinner.stop()

    return printErrorAndExit(`${Yellow('git')} not found. Is it installed on this machine?`) // prettier-ignore
  }

  // get the repo (the origin remote)
  const repoUrl = await git.getOrigin()
  if (!repoUrl) {
    createBuildSpinner.stop()

    return printErrorAndExit(
      `${Green('origin')} not found. Check the following:` +
        `  - You are running ${Yellow(
          'boxci',
        )} from the root of your project's repo\n` +
        `  - Your remote repo is configured as ${Green('origin')}`,
    )
  }

  const repoRootDir = await git.getRepoRootDirectory()

  if (!repoRootDir) {
    createBuildSpinner.stop()

    return printErrorAndExit(`Could not find the repo root directory`)
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

  if (!(await git.existsInOrigin({ branch, commit }))) {
    createBuildSpinner.stop()

    const err =
      `Could not find in ${Green('origin')} [${LightBlue(repoUrl)}]\n` +
      `  - ${Yellow('commit')}  ${commit}\n` +
      `  - ${Yellow('branch')}  ${branch}\n\n`

    if (cliOptions.commit) {
      return printErrorAndExit(
        err +
          `Check the following\n` +
          `  - Your local repo is in sync with ${Green('origin')}\n` +
          `  - Typos in the branch or commit`,
      )
    } else {
      return printErrorAndExit(
        err +
          `This is the HEAD of the current branch. Check the following\n` +
          `  - All commits are pushed to ${Green('origin')}\n` +
          `  - Your local repo is in sync with ${Green('origin')}`,
      )
    }
  }

  return {
    repoUrl,
    repoRootDir,
    commit,
    branch,
  }
}

// --------- Build Mode ---------
cli
  .command('build')
  .option('-c, --commit <arg>')
  .action(async (cliOptions: any) => {
    printTitle(true)
    const startingBuildSpinner = spinner('Creating build...')

    const {
      repoUrl,
      repoRootDir,
      commit,
      branch,
    } = await getProjectBuildConfigForBuildMode(
      cliOptions,
      startingBuildSpinner,
    )

    const config = getConfig(cli, repoRootDir)

    const { repoDir, logsDir } = await data.prepare(
      repoRootDir,
      startingBuildSpinner,
    )

    try {
      const api = buildApi(config)

      const projectBuild = await api.runProjectBuildDirect({
        commandString: config.command,
        machineName: config.machineName,
        gitBranch: branch,
        gitCommit: commit,
        gitRepoUrl: repoUrl,
      })

      const logFile = new LogFile(
        `${logsDir}/boxci-build-${projectBuild.id}.log`,
        'INFO',
      )

      // clone the project at the commit specified in the projectBuild
      // into the .boxci data dir
      await data.prepareForNewBuild(
        logFile,
        repoRootDir,
        projectBuild,
        startingBuildSpinner,
      )

      await runBuild('direct', projectBuild, repoDir, api, logFile)
    } catch (err) {
      startingBuildSpinner.stop()

      // prettier-ignore
      printErrorAndExit(
        `Failed to start build\n\n` +
          `Could not communicate with service at ${LightBlue(config.service)}\n\n` +
          `Cause:\n\n${err}\n\n`,
      )
    }
  })

// --------- Agent Mode ---------
cli.command('agent').action(async () => {
  printTitle(false)

  // await checkGitInstalled()

  // // sets shelljs current working directory to where the cli is run from,
  // // instead of the directory where the cli script is
  // const cwd = await getCwdIfAtRootOfGitRepo()

  // await fetchGitOrigin()

  // const config = getConfig(cli, cwd)
  // const api = buildApi(config)

  // pollForAndRunAgentBuild(cwd, config, api, startAgentWaitingForBuildSpinner())
})

// Poll every 15 seconds for new jobs to run
// TODO make this configurable?
const AGENT_POLL_INTERVAL = 15000

const startAgentWaitingForBuildSpinner = () =>
  spinner(`${Bright('Waiting for a build job')}`)

const pollForAndRunAgentBuild = async (
  cwd: string,
  config: Config,
  api: ReturnType<typeof buildApi>,
  agentWaitingForBuildSpinner: Spinner,
) => {
  // log('INFO', () => `polling`)
  const projectBuild = await api.runProjectBuildAgent({
    machineName: config.machineName,
  })

  if (projectBuild) {
    // if a project build is returned, run it
    agentWaitingForBuildSpinner.stop(runningBuildMessage(config, projectBuild))
    await runBuild('agent', projectBuild, cwd, api, new LogFile('', 'INFO'))
    agentWaitingForBuildSpinner = startAgentWaitingForBuildSpinner()
  } else {
    // log('INFO', () => `no build found`)
  }

  // recursively poll again after the interval
  setTimeout(() => {
    pollForAndRunAgentBuild(cwd, config, api, agentWaitingForBuildSpinner)
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
