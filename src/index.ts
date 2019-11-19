import { Command } from 'commander'
import CommandLogger from './CommandLogger'
import { buildApi } from './api'
import { log } from './logging'
import ListMessagePrinter from './ListMessagePrinter'
import getConfig, { Config } from './config'
import { customHelpMessage } from './help'
import { Yellow, Bright, Green, Red } from './consoleFonts'
import simplegit from 'simple-git/promise'
import { SERVICE_HOST } from './serviceHost'

const git = simplegit()

const VERSION: string = process.env.NPM_VERSION as string
const cli = new Command()

cli
  .version(VERSION)
  // required options
  .option('-p, --project <arg>')
  .option('-k, --key <arg>')
  // optional options
  .option('-m, --machine <arg>')
  .option('-r, --retries <arg>')

const gitError = ({ type, err }: { type: string; err: any }) => {
  console.log(
    `\n\n${Bright(`Error`)}\n\n` +
      `Could not find git ${type}. Check the following:\n\n` +
      `  - git is installed\n` +
      `  - you're running boxci at the root of your project's git repo\n\n` +
      `Error Output:\n\n`,
    err,
    '\n\n',
  )

  process.exit(1)
}

const getGitBranch = async (): Promise<string> => {
  try {
    return await git.revparse(['--abbrev-ref', 'HEAD'])
  } catch (err) {
    gitError({
      type: 'branch',
      err,
    })

    // won't actually run as above call exists the process, just stops TS from complaining about not returning anything
    return ''
  }
}

const getGitCommit = async (): Promise<string> => {
  try {
    return await git.revparse(['HEAD'])
  } catch (err) {
    gitError({
      type: 'commit',
      err,
    })

    // won't actually run as above call exists the process, just stops TS from complaining about not returning anything
    return ''
  }
}

const runBuild = async (
  cwd: string,
  config: Config,
  api: ReturnType<typeof buildApi>,
  projectBuild?: {
    projectBuildId: string
    commandString: string
    gitBranch: string
    gitCommit: string
  },
) => {
  // if project build is passed, it's an agent build, otherise it's a direct build
  const isDirectBuild = !projectBuild

  const gitBranch = projectBuild ? projectBuild.gitBranch : await getGitBranch()
  const gitCommit = projectBuild ? projectBuild.gitCommit : await getGitCommit()

  let projectBuildId = projectBuild ? projectBuild.projectBuildId : undefined
  let commandString = projectBuild ? projectBuild.commandString : undefined

  const listMessagePrinter = new ListMessagePrinter()

  // prettier-ignore
  log('INFO', () => `CLI config options:\n\n${JSON.stringify(config, null, 2)}\n\n`)

  // start the build by requesting a build run id from the service
  listMessagePrinter.printTitle(isDirectBuild)
  listMessagePrinter.printItem(`Project        ${config.projectId}`) // prettier-ignore
  listMessagePrinter.printItem(`Branch         ${gitBranch}`)
  listMessagePrinter.printItem(`Commit         ${gitCommit}`)

  const startBuildSpinner = isDirectBuild
    ? listMessagePrinter.printListItemSpinner('Starting build...')
    : undefined

  try {
    if (isDirectBuild) {
      const response = await api.runProjectBuildDirect({
        machineName: config.machineName,
        gitBranch,
        gitCommit,
      })

      projectBuildId = response.projectBuildId
      commandString = response.commandString
    }

    const buildItem = `Build          ${SERVICE_HOST}/project/${config.projectId}/build/${projectBuildId}` // prettier-ignore

    if (isDirectBuild) {
      startBuildSpinner!.finish(buildItem)
    } else {
      listMessagePrinter.printItem(buildItem)
    }
    listMessagePrinter.printItem(`Build command  ${Yellow(commandString!)}`) // prettier-ignore
    console.log(`│\n`) // print a newline before build output is printed

    // run the command and send logs to the service
    const commandLogger = new CommandLogger(
      config.projectId,
      projectBuildId!, // typescript can't infer this has been set if it's a direct build because we use different variables isDirectBuild and projectBuild, but it has
      commandString!, // typescript can't infer this has been set if it's a direct build because we use different variables isDirectBuild and projectBuild, but it has
      api,
      cwd,
    )
    const { runtimeMs } = await commandLogger.whenCommandFinished()

    console.log('\n\n│')
    listMessagePrinter.printItem(`Runtime ${runtimeMs}ms\n│`) // prettier-ignore

    const finishSendingLogsSpinner = listMessagePrinter.printListItemSpinner('Completing build...') // prettier-ignore

    const allLogsSentResult = await commandLogger.whenAllLogsSent()

    if (!allLogsSentResult.errors) {
      finishSendingLogsSpinner.finish(
        allLogsSentResult.commandReturnCode === 0
          ? Green('✓ Build succeeded')
          : Red('✗ Build failed'),
        '│',
      )

      console.log(`\n`) // print a newline before finishing output
    } else {
      const numberOfErrors =
        allLogsSentResult.sendChunkErrors!.length +
        (allLogsSentResult.doneEventError ? 1 : 0)
      finishSendingLogsSpinner.finish(`Failed to send all logs - ${numberOfErrors} failed requests:\n\n`) // prettier-ignore
      let errorCount = 1
      if (allLogsSentResult.doneEventError) {
        console.log(`[${errorCount++}]  The 'done' event failed to send, cause:\n    ${errorCount < 10 ? ' ' : ''}- ${allLogsSentResult.doneEventError}\n`) // prettier-ignore
      }
      // exit process with error code
      for (let error of allLogsSentResult.sendChunkErrors!) {
        console.log(`[${errorCount++}]  Error sending a log chunk, cause:\n    ${errorCount < 10 ? ' ' : ''}- ${error}\n`) // prettier-ignore
      }

      process.exit(1)
    }
  } catch (errGettingRunId) {
    const errorMessage = `Failed to start build\n\n\n${Bright('Could not communicate with service')}.\n\nCause:\n\n${errGettingRunId}\n\n` // prettier-ignore

    // if using the spinner, log as result of that, else just log as new list item
    if (startBuildSpinner) {
      startBuildSpinner.finish(errorMessage) // prettier-ignore
    } else {
      listMessagePrinter.printItem(errorMessage)
    }

    process.exit(1)
  }
}

cli.command('build').action(() => {
  // sets shelljs current working directory to where the cli is run from,
  // instead of the directory where the cli script is
  const cwd = process.cwd()
  const config = getConfig(cli, cwd)
  const api = buildApi(config)

  runBuild(cwd, config, api)
})

// Poll every 15 seconds for new jobs to run
// TODO make this configurable?
const AGENT_POLL_INTERVAL = 15000

const logAgentModeListening = () => {
  console.log(`\n\n${Bright('Waiting for build jobs...')}\n\n`)
}

const pollForAndRunAgentBuild = async (
  cwd: string,
  config: Config,
  api: ReturnType<typeof buildApi>,
) => {
  log('INFO', () => `polling`)
  const projectBuild = await api.runProjectBuildAgent({
    machineName: config.machineName,
  })

  if (projectBuild) {
    // if a project build is returned, run it
    await runBuild(cwd, config, api, projectBuild)
    logAgentModeListening()
  } else {
    log('INFO', () => `no build found`)
  }

  // recursively poll again after the interval
  setTimeout(() => {
    pollForAndRunAgentBuild(cwd, config, api)
  }, AGENT_POLL_INTERVAL)
}

// agent subcommand
// this runs forever until interrupted by recursively calling setTimeouts
cli.command('agent').action(() => {
  // sets shelljs current working directory to where the cli is run from,
  // instead of the directory where the cli script is
  const cwd = process.cwd()
  const config = getConfig(cli, cwd)
  const api = buildApi(config)

  logAgentModeListening()
  pollForAndRunAgentBuild(cwd, config, api)
})

// override -h, --help default behaviour from commanderjs
// use the custom help messaging defined in ./help.ts
if (
  process.argv.indexOf('-h') !== -1 ||
  process.argv.indexOf('--help') !== -1
) {
  cli.help(customHelpMessage)
}

cli.parse(process.argv)

// if no args passed, display customer help message
if (cli.args.length === 0) {
  cli.help(customHelpMessage)
}
