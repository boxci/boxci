import { Command } from 'commander'
import api, {
  DEFAULT_RETRIES,
  Project,
  ProjectBuild,
  ProjectBuildPipeline,
} from './api'
import {
  getProjectConfig,
  ProjectBuildConfig,
  ProjectConfig,
  readProjectBuildConfig,
} from './config'
import { Bright, Green, LightBlue, Yellow } from './consoleFonts'
import help from './help'
import BuildLogger from './BuildLogger'
import { printErrorAndExit } from './logging'
import Spinner, { SpinnerOptions } from './Spinner'
import { wait, lineOfLength } from './util'
import BuildRunner from './BuildRunner'
import { setupBoxCiDirs } from './data'

const VERSION: string = process.env.NPM_VERSION as string
const cli = new Command()

cli
  .version(VERSION)
  .option('-m, --machine <arg>')
  .option('-r, --retries <arg>')
  .option('-s, --service <arg>')

const printProjectConfig = (projectConfig: ProjectConfig) =>
  `${Bright('Agent')}      ${projectConfig.agentName}\n` +
  `${Bright('Project')}    ${projectConfig.projectId}\n`

const printProjectBuild = (
  projectConfig: ProjectConfig,
  projectBuild: ProjectBuild,
  logsDir: string,
) =>
  // prettier-ignore
  `${Bright('Build')}      ${projectBuild.id}\n` +
  `${Bright('Commit')}     ${projectBuild.gitCommit}\n` +

  (projectBuild.gitTag ?
  `${Bright('Tag')}        ${projectBuild.gitTag}\n` : '') +

  (projectBuild.gitBranch ?
  `${Bright('Branch')}     ${projectBuild.gitBranch}\n` : '') +

  `${Bright('Link')}       ${LightBlue(`${projectConfig.service}/p/${projectConfig.projectId}/${projectBuild.id}`)}\n` +

  `${Bright('Logs')}       ${Yellow(`${logsDir}/${projectBuild.id}/logs.txt`)}\n`

// time to wait between polling for builds
const BUILD_POLLING_INTERVAL = 10000

cli.command('agent').action(async () => {
  printTitle()

  const cwd = process.cwd()

  // get the project level config, which does not change commit to commit,
  // at the start and keep it the same for the entire lifetime of the agent
  const projectConfig = getProjectConfig(cli, cwd)

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
  const { logsDir } = setupBoxCiDirs({
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

  // keep a cache of builds in memory,
  // each loop iteration check and evict
  // ones that are synced to avoid memory leak
  const syncingBuilds: Array<BuildRunner> = []

  // poll for project builds until command exited
  while (true) {
    // prettier-ignore
    const waitingForBuildSpinner = new Spinner(
      {
        type: 'listening',
        text: `\n\n`,
        prefixText: `${printedProjectConfig}\n\n${Green('Listening for builds')} `,
        enabled: projectConfig.spinnersEnabled
      },
      (options: SpinnerOptions) => ({
        ...options,
        prefixText: `${printedProjectConfig}\n\n${Yellow('Lost connection with Box CI. Reconnecting')} `,
      }),
    )

    waitingForBuildSpinner.start()

    let projectBuild
    try {
      projectBuild = await api.getProjectBuildToRun({
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

    // if a project build is picked from the queue, run it
    if (projectBuild) {
      const logger = new BuildLogger(logsDir, projectBuild, 'INFO')
      const git = new Git(logger)

      // clone the project at the commit specified in the projectBuild into the data dir
      const preparedForNewBuild = await data.prepareForNewBuild({
        projectConfig,
        git,
        repoDir,
        project,
        projectBuild,
        logger,
        spinner: waitingForBuildSpinner,
      })

      // if could not prepare for this build, an exception is not thrown, the function just returns false
      // if this happens don't throw an error, just skip to the next one - the build will time out
      if (!preparedForNewBuild) {
        logger.writeEvent('INFO', `Could not prepare for build ${projectBuild.id}, so it will not run. Continuing to listen for new builds.`) // prettier-ignore
        waitingForBuildSpinner.stop()
        break
      }

      // if projectBuild has no branch set, try to get the branch from the commit
      // and update the build with it if possible
      if (!projectBuild.gitBranch) {
        logger.writeEvent('INFO', `Build ${projectBuild.id} does not have a branch set, attempting to discover the branch from the commit ${projectBuild.gitCommit}`) // prettier-ignore
        const gitBranches = await git.getBranchesForCommit(
          projectBuild.gitCommit,
        )
        logger.writeEvent('INFO', `Commit ${projectBuild.gitCommit} is present on the following branches ${JSON.stringify(gitBranches)}`) // prettier-ignore

        // only select a branch if there's only one option
        if (gitBranches.length === 1) {
          const gitBranch = gitBranches[0]
          projectBuild.gitBranch = gitBranch

          logger.writeEvent('INFO', `Setting build ${projectBuild.id} branch as ${gitBranch}`) // prettier-ignore
          try {
            await api.setProjectBuildGitBranch({
              projectConfig,
              payload: {
                projectBuildId: projectBuild.id,
                gitBranch,
              },
              spinner: waitingForBuildSpinner,
              retries: DEFAULT_RETRIES,
            })
            logger.writeEvent('INFO', `Set build ${projectBuild.id} branch as ${gitBranch}`) // prettier-ignore
          } catch (err) {
            logger.writeError(`Could not set build ${projectBuild.id} branch as ${gitBranch}`, err) // prettier-ignore
            // just continue if req timed out, it's fine if we can't set the branch, just a UX feature
          }
        }
      }

      // read the project build level config, which may change commit to commit
      // unlike the projectConfig, at the start of every build from the files pulled
      // from the builds commit
      logger.writeEvent('INFO', `Reading build ${projectBuild.id} config`) // prettier-ignore
      const projectBuildConfig = readProjectBuildConfig(
        repoDir,
        projectBuild.gitCommit,
        waitingForBuildSpinner,
      )
      logger.writeEvent('INFO', `Read build ${projectBuild.id} config`) // prettier-ignore

      logger.writeEvent('INFO', `Matching build ${projectBuild.id} pipeline`) // prettier-ignore
      // try to match a pipeline in the project build config to the ref for this commit
      const pipeline:
        | ProjectBuildPipeline
        | undefined = getProjectBuildPipeline(projectBuild, projectBuildConfig)

      // if a matching pipeline found, run it
      if (pipeline) {
        projectBuild.pipeline = pipeline
        logger.writeEvent('INFO', `Matched build ${projectBuild.id} pipeline ${pipeline.n} with tasks ${JSON.stringify(pipeline.t)}`) // prettier-ignore
        logger.writeEvent('INFO', `Setting build ${projectBuild.id} pipeline on server`) // prettier-ignore

        try {
          await api.setProjectBuildPipeline({
            projectConfig,
            payload: {
              projectBuildId: projectBuild.id,
              pipeline,
            },
            spinner: waitingForBuildSpinner,
            retries: DEFAULT_RETRIES,
          })
          logger.writeEvent('INFO', `Set build ${projectBuild.id} pipeline on server`) // prettier-ignore
        } catch (err) {
          // if there is an error setting the pipeline, log and continue on to next build - this build will just time out
          //
          // TODO - this setup work should be done in BuildRunner, not here?
          logger.writeError(`Could not set build ${projectBuild.id} pipeline on server`, err) // prettier-ignore

          waitingForBuildSpinner.stop()
          continue
        }

        waitingForBuildSpinner.stop(
          printedProjectConfig +
            printProjectBuild(projectConfig, projectBuild, logsDir),
        )

        const buildRunner = new BuildRunner({
          projectConfig,
          projectBuild,
          cwd,
          logsDir,
        })

        logger.writeEvent('INFO', `Starting build ${projectBuild.id}`) // prettier-ignore
        await buildRunner.run()
        logger.writeEvent('INFO', `Completed build ${projectBuild.id} (locally - logs and metadata may still syncing with server)`) // prettier-ignore

        // push the buildRunner onto the cache to keep the reference around until it's synced
        syncingBuilds.push(buildRunner) // buildrunner starts syncing on build -- perhaps should separate this out?

        // evict synced builds
        // go backwards through the array so that splice does not change
        // indexes as we go through and remove entries
        const buildIdsNotSyncedWithServer = []
        for (let i = syncingBuilds.length - 1; i >= 0; i--) {
          const currentBuild = syncingBuilds[i]
          if (currentBuild.isSynced()) {
            logger.writeEvent('INFO', `Build ${currentBuild.projectBuild.id} fully synced with server`) // prettier-ignore
            syncingBuilds.splice(i, 1) // removes the element at index i
          } else {
            buildIdsNotSyncedWithServer.push(currentBuild.projectBuild.id + '')
          }
        }

        if (buildIdsNotSyncedWithServer.length === 0) {
          logger.writeEvent('INFO', `All builds fully synced with server`) // prettier-ignore
        } else {
          logger.writeEvent('INFO', `The following builds are not yet fully synced with server: ${JSON.stringify(buildIdsNotSyncedWithServer.reverse())}`) // prettier-ignore
        }
      }
      // if no matching pipeline found, cancel the build
      else {
        logger.writeEvent('INFO', `No matching pipeline found for build ${projectBuild.id}, setting this on server...`) // prettier-ignore
        try {
          await api.setProjectBuildNoMatchingPipeline({
            projectConfig,
            payload: { projectBuildId: projectBuild.id },
            spinner: waitingForBuildSpinner,
            retries: DEFAULT_RETRIES,
          })
          logger.writeEvent('INFO', `Set no matching pipeline found for build ${projectBuild.id} on server`) // prettier-ignore
        } catch (err) {
          // ignore errors here, build will just time out
          logger.writeError(`Could not set no matching pipleine for ${projectBuild.id} on server`, err) // prettier-ignore
        }

        let matchingRef = ''
        if (projectBuild.gitTag) {
          matchingRef += `tag [${projectBuild.gitTag}]`
        }
        if (projectBuild.gitBranch) {
          if (matchingRef) {
            matchingRef += ' or '
          }
          matchingRef += `branch [${projectBuild.gitBranch}]`
        }

        waitingForBuildSpinner.stop(
          printedProjectConfig +
            `\n` +
            `No pipeline matches ${matchingRef}\n\n` +
            `Check ${Green('boxci.json')} at commit [${projectBuild.gitCommit}]\n\n`, // prettier-ignore
        )
      }
    } else {
      // if no build is ready to be run this time,
      // wait for the interval time before polling again
      await wait(BUILD_POLLING_INTERVAL)
      waitingForBuildSpinner.stop()
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

const printTitle = () => {
  const title = 'Box CI agent'
  const version = `v${VERSION}`
  const space = '   '
  const line = lineOfLength((title + space + version).length)
  const titleString = `${Bright(title)}${space}${version}`

  console.log('')
  console.log(LightBlue(line))
  console.log(titleString)
  console.log(LightBlue(line))
  console.log('')

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
