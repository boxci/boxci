import { Command } from 'commander'
import api, {
  DEFAULT_RETRIES,
  Project,
  ProjectBuild,
  StopAgentResponse,
} from './api'
import BuildRunner, { PIPE_WITH_INDENT } from './BuildRunner'
import { getProjectConfig, ProjectConfig } from './config'
import { Bright, Green, LightBlue, Yellow } from './consoleFonts'
import { LOGS_DIR_NAME, setupBoxCiDirs } from './data'
import help from './help'
import { printErrorAndExit, printTitle } from './logging'
import Spinner, { SpinnerOptions } from './Spinner'
import { wait } from './util'

const VERSION: string = process.env.NPM_VERSION as string
const cli = new Command()

cli
  .version(VERSION)
  .option('-m, --machine <arg>')
  .option('-r, --retries <arg>')
  .option('-s, --service <arg>')

const printProjectConfig = (projectConfig: ProjectConfig) =>
  `${PIPE_WITH_INDENT}${Bright('Agent')}      ${projectConfig.agentName}\n` +
  `${PIPE_WITH_INDENT}${Bright('Project')}    ${projectConfig.projectId}\n` // prettier-ignore

const printProjectBuild = ({
  projectConfig,
  projectBuild,
  dataDir,
}: {
  projectConfig: ProjectConfig
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
  `${PIPE_WITH_INDENT}${Bright('Link')}       ${LightBlue(`${projectConfig.service}/p/${projectConfig.projectId}/${projectBuild.id}`)}\n${PIPE_WITH_INDENT}`

// see comments below - multiply this by 2 to get the actual build polling interval
const BUILD_POLLING_INTERVAL_DIVIDED_BY_TWO = 5000 // 5 seconds * 2 = 10 seconds build polling interval time

cli.command('agent').action(async () => {
  printTitle()

  const cwd = process.cwd()

  // get the project level config, which does not change commit to commit,
  // at the start and keep it the same for the entire lifetime of the agent
  const projectConfig = getProjectConfig({ cli, cwd })

  const setupSpinner = new Spinner(
    {
      type: 'listening',
      text: `\n\n`,
      prefixText: `\n\nConnecting to Box CI Service `,
      enabled: projectConfig.spinnersEnabled,
    },
    // don't change the message in case of API issues
    undefined,
  )

  setupSpinner.start()

  // NOTE if this errors, it exits
  const dataDir = setupBoxCiDirs({
    rootDir: cwd,
    spinner: setupSpinner,
  })

  const printedProjectConfig = printProjectConfig(projectConfig)

  let project: Project
  try {
    project = await api.getProject({
      projectConfig,
      payload: { agentName: projectConfig.agentName },
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
    printErrorAndExit(err.message, setupSpinner)

    // just so TS knows that project is not undefined
    return
  }

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

    // prettier-ignore
    const waitingForBuildSpinner = new Spinner(
      {
        type: 'listening',
        text: `\n`,
        prefixText: `${printedProjectConfig}${PIPE_WITH_INDENT}\n${PIPE_WITH_INDENT}${Yellow('Listening for builds')} `,
        enabled: projectConfig.spinnersEnabled
      },
      (options: SpinnerOptions) => ({
        ...options,
        prefixText: `${printedProjectConfig}${PIPE_WITH_INDENT}\n${PIPE_WITH_INDENT}${Yellow('Reconnecting with Box CI')} `,
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

    let getProjectBuildToRunResponse
    try {
      getProjectBuildToRunResponse = await api.getProjectBuildToRun({
        projectConfig,
        payload: {
          agentName: projectConfig.agentName,
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
      // prettier-ignore
      if ((<StopAgentResponse>getProjectBuildToRunResponse).__stop__agent !== undefined) {
        waitingForBuildSpinner.stop(
          printedProjectConfig +
          PIPE_WITH_INDENT +
          '\n' + PIPE_WITH_INDENT + Bright('- - - - - - - - - - - - - - - - -') +
          '\n' + PIPE_WITH_INDENT +
          '\n' + PIPE_WITH_INDENT + Bright('Agent stopped from Box CI service') +
          '\n\n'
        )

        process.exit(0)
      }

      const projectBuild = getProjectBuildToRunResponse as ProjectBuild

      waitingForBuildSpinner.stop(
        printedProjectConfig +
          printProjectBuild({ projectConfig, projectBuild, dataDir }),
      )

      const buildRunner = new BuildRunner({
        project,
        projectConfig,
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
