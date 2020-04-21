import { Command } from 'commander'
import api, {
  DEFAULT_RETRIES,
  Project,
  ProjectBuild,
  StopAgentResponse,
} from './api'
import BuildRunner, { PIPE_WITH_INDENT } from './BuildRunner'
import { getAgentConfig, AgentConfig } from './config'
import { Bright, Green, LightBlue, Yellow, Red } from './consoleFonts'
import {
  LOGS_DIR_NAME,
  setupBoxCiDataForAgent,
  writeToAgentInfoFileSync,
} from './data'
import help from './help'
import { printErrorAndExit, printTitle } from './logging'
import Spinner, { SpinnerOptions } from './Spinner'
import { wait } from './util'
import validate from './validate'

const VERSION: string = process.env.NPM_VERSION as string
const cli = new Command()

cli
  .version(VERSION)
  // required
  .option('-p, --project <arg>')
  .option('-k, --key <arg>')
  // optional
  .option('-m, --machine <arg>')

const BLUE_PIPE_WITH_INDENT = `${LightBlue('│')} `

const printAgentConfig = (agentConfig: AgentConfig) =>
  `${PIPE_WITH_INDENT}${Bright('Agent')}      ${agentConfig.agentName}\n` +
  `${PIPE_WITH_INDENT}${Bright('Project')}    ${agentConfig.projectId}\n` // prettier-ignore

const printProjectBuild = ({
  agentConfig,
  projectBuild,
  dataDir,
}: {
  agentConfig: AgentConfig
  projectBuild: ProjectBuild
  dataDir: string
}) =>
  // prettier-ignore
  `${PIPE_WITH_INDENT}${Bright('Build')}      ${projectBuild.id}\n` +
  `${PIPE_WITH_INDENT}${Bright('Commit')}     ${projectBuild.gitCommit}\n` +

  (projectBuild.gitTag ?
  `${PIPE_WITH_INDENT}${Bright('Tag')}        ${projectBuild.gitTag}\n` : '') +

  (projectBuild.gitBranch ?
  `${PIPE_WITH_INDENT}${Bright('Branch')}     ${projectBuild.gitBranch}\n` : '') +

  `${PIPE_WITH_INDENT}${Bright('Logs')}       ${dataDir}/${LOGS_DIR_NAME}/${projectBuild.id}/logs.txt\n` +
  `${PIPE_WITH_INDENT}${Bright('Link')}       ${LightBlue(`${agentConfig.service}/p/${agentConfig.projectId}/${projectBuild.id}`)}\n${PIPE_WITH_INDENT}`

// see comments below - multiply this by 2 to get the actual build polling interval
const BUILD_POLLING_INTERVAL_DIVIDED_BY_TWO = 5000 // 5 seconds * 2 = 10 seconds build polling interval time

cli.command('agent').action(async () => {
  printTitle()

  const cwd = process.cwd()

  // get the agent level config, which does not change build to build,
  // this comes from a combination of cli options and env vars
  const agentConfig = getAgentConfig({ cli })

  const setupSpinner = new Spinner(
    {
      type: 'listening',
      text: `\n\n`,
      prefixText: `\n\nConnecting to Box CI Service `,
      enabled: agentConfig.spinnersEnabled,
    },
    // don't change the message in case of API issues
    undefined,
  )

  setupSpinner.start()

  // NOTE if this errors, agent exits
  const { dataDir } = setupBoxCiDataForAgent({
    agentConfig,
    spinner: setupSpinner,
  })

  const projectConfigConsoleOutput = printAgentConfig(agentConfig)

  let project: Project
  try {
    project = await api.getProject({
      agentConfig,
      payload: {
        n: agentConfig.agentName,
        v: VERSION,
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
    writeToAgentInfoFileSync({
      agentName: agentConfig.agentName,
      updates: {
        stopTime: Date.now(),
        stopReason: 'generic-error',
      },
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
      projectConfigConsoleOutput +
      `${PIPE_WITH_INDENT}\n` +
      PIPE_WITH_INDENT

    // prettier-ignore
    const waitingForBuildSpinner = new Spinner(
      {
        type: 'listening',
        text: `\n`,
        prefixText: `${spinnerConsoleOutput}${Yellow('Listening for builds')} `,
        enabled: agentConfig.spinnersEnabled
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

    let getProjectBuildToRunResponse
    try {
      getProjectBuildToRunResponse = await api.getProjectBuildToRun({
        agentConfig,
        payload: {
          n: agentConfig.agentName,
          v: VERSION,
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

        waitingForBuildSpinner.stop(
          projectConfigConsoleOutput +
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
          projectConfigConsoleOutput +
          PIPE_WITH_INDENT +
          '\n' + PIPE_WITH_INDENT + Red('Error preparing build') + (invalidProjectBuildId ? ` ${invalidProjectBuildId}` : '') +
          '\n\n'
        )

        await wait(BUILD_POLLING_INTERVAL_DIVIDED_BY_TWO)

        continue
      }

      waitingForBuildSpinner.stop(
        projectConfigConsoleOutput +
          printProjectBuild({
            agentConfig,
            projectBuild,
            dataDir,
          }),
      )

      const buildRunner = new BuildRunner({
        project,
        agentConfig,
        projectBuild,
        cwd,
        dataDir,
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

            writeToAgentInfoFileSync({
              agentName: agentConfig.agentName,
              updates: {
                stopTime: Date.now(),
                stopReason: 'unsupported-version',
              },
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
