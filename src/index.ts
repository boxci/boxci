import { Command } from 'commander'
import api, {
  DEFAULT_RETRIES,
  Project,
  ProjectBuild,
  StopAgentResponse,
} from './api'
import BuildRunner, { PIPE_WITH_INDENT } from './BuildRunner'
import { AgentCommandCliOptions, AgentConfig, getAgentConfig } from './config'
import { Bright, Green, LightBlue, Red, Yellow } from './consoleFonts'
import {
  createAgentMeta,
  createBuildDir,
  getShouldStopAgent,
  stopAgent,
  writeAgentStoppedMeta,
  cleanStopAgentMetaFile,
} from './data2'
import help from './help'
import historyCommand from './historyCommand'
import { formattedTime, printAgentTitle, printErrorAndExit } from './logging'
import logsCommand from './logsCommand'
import Spinner, { SpinnerOptions } from './Spinner'
import stopCommand from './stopCommand'
import { wait } from './util'
import validate from './validate'
import clearLogsCommand from './clearLogsCommand'

const VERSION: string = process.env.NPM_VERSION as string
const cli = new Command()

cli.version(VERSION)

const BLUE_PIPE_WITH_INDENT = `${LightBlue('│')} `

// prettier-ignore
const printAgentConfig = (agentConfig: AgentConfig) =>
  `${PIPE_WITH_INDENT}${Bright('Project')}    ${agentConfig.projectId}\n` +
  `${PIPE_WITH_INDENT}${Bright('Agent')}      ${agentConfig.agentName}\n` +
  (agentConfig.machineName ?
  `${PIPE_WITH_INDENT}${Bright('Machine')}    ${agentConfig.machineName}\n` : '')

const printProjectBuild = ({
  agentConfig,
  projectBuild,
}: {
  agentConfig: AgentConfig
  projectBuild: ProjectBuild
}) =>
  // prettier-ignore
  `${PIPE_WITH_INDENT}\n` +

  `${PIPE_WITH_INDENT}${Bright('Build')}      ${projectBuild.id}\n` +

  (projectBuild.startedAt ?
  `${PIPE_WITH_INDENT}${Bright('Started')}    ${formattedTime(projectBuild.startedAt)}\n` : '') +

  `${PIPE_WITH_INDENT}${Bright('Commit')}     ${projectBuild.gitCommit}\n` +

  (projectBuild.gitTag ?
  `${PIPE_WITH_INDENT}${Bright('Tag')}        ${projectBuild.gitTag}\n` : '') +

  (projectBuild.gitBranch ?
  `${PIPE_WITH_INDENT}${Bright('Branch')}     ${projectBuild.gitBranch}\n` : '') +

  `${PIPE_WITH_INDENT}${Bright('Link')}       ${LightBlue(`${agentConfig.service}/p/${agentConfig.projectId}/${projectBuild.id}`)}\n` +

  `${PIPE_WITH_INDENT}${Bright('Logs')}       ${Yellow(`tail -f $(boxci logs ${projectBuild.id})`)}\n${PIPE_WITH_INDENT}`

// see comments below - multiply this by 2 to get the actual build polling interval
const BUILD_POLLING_INTERVAL_DIVIDED_BY_TWO = 5000 // 5 seconds * 2 = 10 seconds build polling interval time

cli
  .command('agent')

  // required options
  .option('-p, --project <arg>')
  .option('-k, --key <arg>')

  // optional options
  .option('-m, --machine <arg>')
  .option('-ns, --no-spinner')

  .action(async (options: AgentCommandCliOptions) => {
    printAgentTitle()

    const cwd = process.cwd()

    // get the agent level config, which does not change build to build,
    // this comes from a combination of cli options and env vars
    const agentConfig = getAgentConfig({ options })

    if (agentConfig.usingTestService) {
      console.log(`\n\n${Yellow('USING TEST SERVICE')} ${LightBlue(agentConfig.service)}\n\n`) // prettier-ignore
    }

    const setupSpinner = new Spinner(
      {
        type: 'listening',
        text: `\n\n`,
        prefixText: `Connecting to Box CI Service `,
        enabled: agentConfig.spinnerEnabled,
      },
      // don't change the message in case of API issues
      undefined,
    )

    setupSpinner.start()

    // NOTE this exits if there is an error
    const agentMetaDir = createAgentMeta({ agentConfig, spinner: setupSpinner })

    const agentConfigConsoleOutput = printAgentConfig(agentConfig)

    let project: Project
    try {
      project = await api.getProject({
        agentConfig,
        payload: {
          n: agentConfig.agentName,
          v: VERSION,
          ...(agentConfig.machineName && { m: agentConfig.machineName }),
        },
        spinner: setupSpinner,
        retries: { period: 10000, max: 6 },

        // on 502s here keep retrying indefinitely every 30s
        // if agents are auto started during service outage
        // (i.e. nobody manually looking at the start process to
        // check if they started) they shouldn't just not start,
        // they should keep running and start as soon as service
        // becomes available
        indefiniteRetryPeriodOn502Error: 30000,
      })
    } catch (err) {
      // in theory this should never happen, but just shut down the agent if there is any kind of error thrown here
      writeAgentStoppedMeta({
        agentName: agentConfig.agentName,
        stopReason: 'error-getting-project',
      })

      printErrorAndExit(err.message, setupSpinner)

      // just so TS knows that project is not undefined
      // the above line will exit anyway
      return
    }

    // this will get polled for and updated every 3 polling cycles
    let cliVersionWarning = await checkCliVersion(agentConfig, setupSpinner)
    const CHECK_CLI_VERSION_EVERY_N_CYCLES = 8
    let checkCliVersionCounter = 1

    setupSpinner.stop()

    // keep build runners in this array until they finish syncing
    // then stop and evict them
    const buildRunners: Array<BuildRunner> = []

    // poll for project builds until command exited
    while (true) {
      // before starting new loop, evict synced builds
      //
      // go backwards through the array so that splice does not change indexes as we go through and remove entries
      for (let i = buildRunners.length - 1; i >= 0; i--) {
        const thisBuildRunner = buildRunners[i]
        if (thisBuildRunner.isSynced()) {
          thisBuildRunner.stopSyncing()
          buildRunners.splice(i, 1) // removes the element at index i
        }
      }

      const spinnerConsoleOutput =
        cliVersionWarning + // will be a blank string if no warning, otherwise will show above the regular console output
        agentConfigConsoleOutput +
        `${PIPE_WITH_INDENT}\n` +
        PIPE_WITH_INDENT

      // prettier-ignore
      const waitingForBuildSpinner = new Spinner(
      {
        type: 'listening',
        text: `\n`,
        prefixText: `${spinnerConsoleOutput}${Yellow('Listening for builds')} `,
        enabled: agentConfig.spinnerEnabled
      },
      (options: SpinnerOptions) => ({
        ...options,
        prefixText: `${spinnerConsoleOutput}${Yellow('Reconnecting with Box CI')} `,
      }),
    )

      waitingForBuildSpinner.start()

      // wait half the interval time before each poll
      // if no build is found we'll wait the other half of the time,
      // otherwise we'll run a build.
      // why not just wait the full interval when no build is found?
      // well firstly as a guard against super quick builds causing the
      // loop to run really fast (or any bugs causing this to happen)
      // and then, because at this point the spinner is showing. If we
      // did the full wait after no build found and half wait after
      // a build runs, we'd need to have a new spinner for that time in the
      // build case - this would cause a bit of flicker, so just better
      // to do it this way
      await wait(BUILD_POLLING_INTERVAL_DIVIDED_BY_TWO)

      // poll for version manifest, and warn if any warnings, every CHECK_CLI_VERSION_EVERY_N_CYCLES cycles
      if (checkCliVersionCounter === 0) {
        cliVersionWarning = await checkCliVersion(
          agentConfig,
          waitingForBuildSpinner,
        )
      }

      // this does a modulo operation which counts the counter up each loop, from 0 to CHECK_CLI_VERSION_EVERY_N_CYCLES - 1
      // before cycling back to 0 - we run checkCliVersion whenever the counter cycles back to 0
      checkCliVersionCounter = (checkCliVersionCounter + 1) % CHECK_CLI_VERSION_EVERY_N_CYCLES // prettier-ignore

      // right before polling for a build, check if agent was stopped in the meantime from the cli,
      // and stop it if so
      const shouldStopAgent = getShouldStopAgent({
        agentName: agentConfig.agentName,
      })

      // will be false either if there is no stop agent meta file for this agent
      // or if there was an error reading the file, in which case just continue
      if (shouldStopAgent) {
        waitingForBuildSpinner.stop(
          agentConfigConsoleOutput +
            PIPE_WITH_INDENT +
            '\n' +
            PIPE_WITH_INDENT +
            Bright('- - - - - - - - - - - - - - - - -') +
            '\n' +
            PIPE_WITH_INDENT +
            '\n' +
            PIPE_WITH_INDENT +
            // prettier-ignore
            `${Bright(`Agent stopped via`)} ${Yellow(`stop`)} ${Bright('command')}` +
            '\n\n',
        )

        writeAgentStoppedMeta({
          agentName: agentConfig.agentName,
          stopReason: 'stopped-from-cli',
        })

        // delete the stop agent meta file which is no longer needed
        cleanStopAgentMetaFile({ agentName: agentConfig.agentName })

        process.exit(0)
      }

      let getProjectBuildToRunResponse
      try {
        getProjectBuildToRunResponse = await api.getProjectBuildToRun({
          agentConfig,
          payload: {
            n: agentConfig.agentName,
            v: VERSION,
            ...(agentConfig.machineName && { m: agentConfig.machineName }),
          },
          spinner: waitingForBuildSpinner,
          retries: DEFAULT_RETRIES,

          // on 502s here keep retrying indefinitely every 30s
          // if agents are waiting for builds and there is service outage,
          // they definitely should not stop - they should keep running
          // and start listening for builds again as soon as the service
          // becomes available
          indefiniteRetryPeriodOn502Error: 30000,
        })
      } catch (err) {
        // if an error polling for builds, like server not available,
        // just log this and fall through - if no project build defined nothing will happen and
        // cli will try again after interval
        //
        // TODO log this in log file
      }

      // if a project build is available to run this time, run it
      if (getProjectBuildToRunResponse) {
        // if the response is the special stop agent response with the __stop__agent flag
        // then shut down the agent
        if (
          (<StopAgentResponse>getProjectBuildToRunResponse).__stop__agent !== undefined // prettier-ignore
        ) {
          try {
            await wait(2000)
            await api.setAgentStopped({
              agentConfig,
              payload: {
                projectBuildId: agentConfig.projectId,
                agentName: agentConfig.agentName,
              },
              spinner: waitingForBuildSpinner,
              retries: DEFAULT_RETRIES,
            })
          } catch (err) {
            // do nothing on error, continue to stop the agent
          }

          writeAgentStoppedMeta({
            agentName: agentConfig.agentName,
            stopReason: 'stopped-from-app',
          })

          waitingForBuildSpinner.stop(
            agentConfigConsoleOutput +
              PIPE_WITH_INDENT +
              '\n' +
              PIPE_WITH_INDENT +
              Bright('- - - - - - - - - - - - - - - - -') +
              '\n' +
              PIPE_WITH_INDENT +
              '\n' +
              PIPE_WITH_INDENT +
              Bright('Agent stopped from Box CI service') +
              '\n\n',
          )

          process.exit(0)
        }

        const projectBuild = validate.projectBuild(getProjectBuildToRunResponse)

        // if the project build received from the service failed validation in any way,
        // do not proceed, just log out that the build could not run and skip to the next build
        // the build will time out eventually
        if (projectBuild === undefined) {
          // @ts-ignore
          const invalidProjectBuildId = getProjectBuildToRunResponse.id

          // prettier-ignore
          waitingForBuildSpinner.stop(
          agentConfigConsoleOutput +
          PIPE_WITH_INDENT +
          '\n' + PIPE_WITH_INDENT + Red('Error preparing build') + (invalidProjectBuildId ? ` ${invalidProjectBuildId}` : '') +
          '\n\n'
        )

          await wait(BUILD_POLLING_INTERVAL_DIVIDED_BY_TWO)

          continue
        }

        const buildLogsDir = createBuildDir({
          projectBuild,
          agentConfig,
          spinner: waitingForBuildSpinner,
        })

        waitingForBuildSpinner.stop(
          agentConfigConsoleOutput +
            printProjectBuild({
              agentConfig,
              projectBuild,
            }),
        )

        const buildRunner = new BuildRunner({
          project,
          agentConfig,
          projectBuild,
          buildLogsDir,
          agentMetaDir,
          cwd,
        })

        // start syncing the build with the server - the actual output of the build is just saved in memory locally
        // and synced with the server completely asynchronously
        buildRunner.startSync()

        // actually await the build, don't want to start another one before this one has finished
        await buildRunner.run()

        // push the buildRunner onto the cache to keep the reference around until it's synced
        buildRunners.push(buildRunner)
      } else {
        // if no build is ready to be run this time,
        // wait the other half of the interval time before polling again
        // i.e. wait full interval between retries when no build ready
        await wait(BUILD_POLLING_INTERVAL_DIVIDED_BY_TWO)
        waitingForBuildSpinner.stop()
      }
    }
  })

cli.command('stop [agent]').action((agent: string | undefined) => {
  console.log('')

  const args = stopCommand.validateArgs({ agent })

  const result = stopAgent({ agentName: args.agentName })

  switch (result.code) {
    case 'success': {
      console.log(
        `Stopping ${Bright(args.agentName)}\n\n` +
          `If the agent is currently running a build, that will complete first.\n\n`,
      )
      return
    }

    case 'not-found': {
      console.log(`${Bright(args.agentName)} not found. Is the name correct?\n\n`) // prettier-ignore
      return
    }

    case 'already-stopped': {
      console.log(`${Bright(args.agentName)} already stopped (on ${formattedTime(result.detail.stoppedAt, 'at')})\n\n`) // prettier-ignore
      return
    }

    case 'error': {
      console.log(`Error stopping ${Bright(args.agentName)}.\n\nCause:\n\n${result.detail.err}\n\n`) // prettier-ignore
      return
    }

    default: {
      const x: never = result.code

      return x
    }
  }
})

cli
  .command('history [mode]')

  // optional options
  .option('-l, --latest <arg>')

  .action(
    (
      mode: 'builds' | 'projects' | 'agents' | undefined,
      options: {
        latest: string
      },
    ) => {
      console.log('')

      const args = historyCommand.validateArgs({
        modeArgument: mode,
        options,
      })

      console.log(historyCommand.printHistory(args.mode))

      console.log('\n')

      // // if the box ci data dir hasn't been created, it means no agents have run at all on this machine yet
      // // so just fail with this general error
      // if (!boxCiDataDirExists()) {
      //   console.log(`\n∙ No history. No agents have run yet on this machine.\n\n`) // prettier-ignore

      //   return
      // }

      // const args = historyCommand.validateArgs({ agent, options })

      // // if agent arg provided, get *agent* history
      // if (args.agentName !== undefined) {
      //   const { output, agentHistory } = historyCommand.agentHistory({
      //     agentName: args.agentName,
      //     latest: args.latest,
      //   })

      //   if (agentHistory == undefined) {
      //     console.log(
      //       `No history found for ${Bright(args.agentName)}\n\n` +
      //         `The agent name may be incorrect or its history may have been cleaned\n\n`,
      //     )

      //     return
      //   }

      //   if (output === undefined) {
      //     console.log(`${Bright(args.agentName)} has not run any builds yet\n\n`) // prettier-ignore

      //     return
      //   }

      //   const resultsLength = Math.min(agentHistory.numberOfBuilds, args.latest)

      //   console.log(Bright(`History of builds run by ${args.agentName}`) + '\n')
      //   console.log(`Showing latest ${resultsLength} builds (of ${agentHistory.numberOfBuilds} total)`) // prettier-ignore
      //   console.log(`  ∙ use ${Yellow('--latest N')} to view latest ${Yellow('N')} builds (default 10)\n`) // prettier-ignore
      //   console.log(output)

      //   return
      // }

      // // otherwise get full history
      // const { output, history } = historyCommand.fullHistory({
      //   latest: args.latest,
      // })

      // // prettier-ignore
      // if (output === undefined) {
      //   console.log(
      //     `${Bright(`History is clean`)}\n\n` +

      //       (history.info.cleanedAt === undefined
      //         ? '∙ No agents have run yet on this machine.'
      //         : `∙ No agents have run since history last cleaned on ${formattedStartTime(history.info.cleanedAt)}\n\n`),
      //   )

      //   console.log('\n')

      //   return
      // }

      // const totalAgents = history.agents.length
      // const resultsLength = Math.min(totalAgents, args.latest)

      // console.log(Bright(`History of agents run on this machine`) + '\n')
      // console.log(`Showing ${resultsLength} most recently started agents (of ${totalAgents} total)`) // prettier-ignore
      // console.log(`  ∙ use ${Yellow('--latest N')} to view ${Yellow('N')} most recently started agents (default 10)\n`) // prettier-ignore
      // console.log(output)
    },
  )

cli
  .command('clean-logs')

  // optional options - only one of these can be specified, this is validated below
  .option('-b, --build <arg>')
  .option('-p, --project <arg>')
  .option('-a', '--all')

  .action((options: { build: string; project: string; all: boolean }) => {
    console.log('')

    const args = clearLogsCommand.validateArgs({ options })

    if (args.buildId) {
      const error = clearLogsCommand.clearBuildLogs({ buildId: args.buildId })

      if (error) {
        printErrorAndExit(`Could not delete logs for build ${Bright( args.buildId )}\n\nCause:\n\n${error}`) // prettier-ignore
      } else {
        console.log(`Deleted logs for build ${Bright(args.buildId)}\n\n`)
      }

      console.log('\n')

      return
    }

    if (args.projectId) {
      const result = clearLogsCommand.clearAllProjectBuildLogs({
        projectId: args.projectId,
      })

      let message = ''

      if (result.buildLogsCleared.length > 0) {
        message += `Deleted logs for ${result.buildLogsCleared.length} builds:\n`

        result.buildLogsCleared.forEach((build) => {
          message += `\n${build.id}`
        })
      }

      if (result.errors.length > 0) {
        if (result.buildLogsCleared.length > 0) {
          message += '\n\n'
        }

        message += `Could not delete logs for ${result.errors.length} builds:\n`

        result.errors.forEach(({ build, err }) => {
          message += `\n\n${build.id}\n\nError:\n\n${err}`
        })
      }

      message += '\n\n'

      console.log(message)

      return
    }

    if (args.all) {
      const result = clearLogsCommand.clearAllBuildLogs()

      let message = ''

      if (result.buildLogsCleared.length > 0) {
        message += `Deleted logs for ${result.buildLogsCleared.length} builds:\n`

        result.buildLogsCleared.forEach((build) => {
          message += `\n${build.id}`
        })
      }

      if (result.errors.length > 0) {
        if (result.buildLogsCleared.length > 0) {
          message += '\n\n'
        }

        message += `Could not delete logs for ${result.errors.length} builds:\n`

        result.errors.forEach(({ build, err }) => {
          message += `\n\n${build.id}\n\nError:\n\n${err}`
        })
      }

      message += '\n\n'

      console.log(message)

      return
    }
  })

// this command is intended for use as part of a vi or tail command,
// so it outputs the logs file full path requested, with no newline)
// and nothing if there is any error
// or history is not found for the input build id
cli
  .command('logs <buildId>')

  // optional options
  .option('-e, --events')

  .action((buildId: string, options: { events: boolean }) => {
    const logsCommandString = !!options.events
      ? logsCommand.events({ buildId })
      : logsCommand.logs({ buildId })

    if (logsCommandString === undefined) {
      return
    }

    process.stdout.write(logsCommandString)
  })

const checkCliVersion = async (
  agentConfig: AgentConfig,
  spinner: Spinner,
): Promise<string> => {
  try {
    const manifestResponse = await api.getManifest({
      agentConfig,
      payload: { v: VERSION },
      spinner,
      retries: DEFAULT_RETRIES,

      // on 502s here keep retrying indefinitely every 30s
      // if agents are waiting for builds and there is service outage,
      // they definitely should not stop - they should keep running
      // and start listening for builds again as soon as the service
      // becomes available
      indefiniteRetryPeriodOn502Error: 30000,
    })

    // if manifest response is undefined, it just means there was some issue getting the
    // manifest fot this version. If this happens just continue
    //
    // If this cli version is not the latest, show a warning
    if (
      manifestResponse &&
      manifestResponse.thisVersion !== manifestResponse.latestVersion
    ) {
      const newVersion = `${BLUE_PIPE_WITH_INDENT}New version of ${Yellow('boxci')} available: ${Red('v' + manifestResponse.thisVersion)} → ${Green('v' + manifestResponse.latestVersion)}` // prettier-ignore

      // if no warning level, just show the general message
      if (manifestResponse.manifest.w === undefined) {
        return newVersion + '\n\n'
      } else {
        const issues = manifestResponse.manifest.is
          ? ' ∙ ' + manifestResponse.manifest.is!.map(Yellow).join(`\n${BLUE_PIPE_WITH_INDENT} ∙ `) // prettier-ignore
          : ''

        // otherwise do different things according to the warning level
        switch (manifestResponse.manifest.w) {
          case 1:
            return newVersion + `\n${BLUE_PIPE_WITH_INDENT}\n${BLUE_PIPE_WITH_INDENT}Known issues with ${Red('v' + manifestResponse.thisVersion)}\n` + BLUE_PIPE_WITH_INDENT + issues + `\n${BLUE_PIPE_WITH_INDENT}\n${BLUE_PIPE_WITH_INDENT}${Bright('We recommend upgrading')}\n\n\n` // prettier-ignore
          case 2:
            return newVersion + `\n${BLUE_PIPE_WITH_INDENT}\n${BLUE_PIPE_WITH_INDENT}Known issues with ${Red('v' + manifestResponse.thisVersion)}\n` + BLUE_PIPE_WITH_INDENT + issues + `\n${BLUE_PIPE_WITH_INDENT}\n${BLUE_PIPE_WITH_INDENT}${Bright('We strongly recommend upgrading')}\n\n\n` // prettier-ignore
          case 3: {
            // In this case, don't even return, just immediately stop the spinner, print the message and exit
            spinner.stop()

            writeAgentStoppedMeta({
              agentName: agentConfig.agentName,
              stopReason: 'unsupported-version',
            })

            // prettier-ignore
            console.log(
              newVersion + `\n${BLUE_PIPE_WITH_INDENT}\n${BLUE_PIPE_WITH_INDENT}Critical known issues with ${Red('v' + manifestResponse.thisVersion)}\n` + BLUE_PIPE_WITH_INDENT + issues +

              `\n${BLUE_PIPE_WITH_INDENT}\n${BLUE_PIPE_WITH_INDENT}Because of these critical issues ${Red('v' + manifestResponse.thisVersion)}\n${BLUE_PIPE_WITH_INDENT}` +
              `is unsafe to run so ${Yellow('boxci')} will not start\n${BLUE_PIPE_WITH_INDENT}\n${BLUE_PIPE_WITH_INDENT}` +

              `${Bright('Please upgrade to')} ${Green('v' + manifestResponse.latestVersion)} ${Bright('to continue.')}\n${BLUE_PIPE_WITH_INDENT}\n${BLUE_PIPE_WITH_INDENT}` +
              `Sorry for the disruption to your work.\n${BLUE_PIPE_WITH_INDENT}` +
              `This is a last resort to ensure critical issues\n${BLUE_PIPE_WITH_INDENT}with ${Yellow('boxci')} are stopped as soon as they are found\n\n\n`
            )

            process.exit(1)
          }

          default: {
            // just for TS to warn if a warningLevel case is not handled
            let x: never = manifestResponse.manifest.w
          }
        }
      }
    }
  } catch {
    // just continue if this fails
  }

  // no warning or message
  return ''
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
