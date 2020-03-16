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
import * as data from './data'
import { Git } from './git'
import help from './help'
import { LogFile, printErrorAndExit } from './logging'
import Spinner, { SpinnerOptions } from './Spinner'
import { wait, lineOfLength } from './util'

const VERSION: string = process.env.NPM_VERSION as string
const cli = new Command()

cli
  .version(VERSION)
  .option('-m, --machine <arg>')
  .option('-r, --retries <arg>')
  .option('-s, --service <arg>')

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

  (projectBuild.gitBranch ?
  `${Bright('Branch')}     ${projectBuild.gitBranch}\n` : '') +

  `${Bright('Link')}       ${LightBlue(`${projectConfig.service}/p/${projectConfig.projectId}/${projectBuild.id}`)}\n`

// time to wait between polling for builds
const BUILD_POLLING_INTERVAL = 10000

cli.command('agent').action(async () => {
  printTitle()

  const setupSpinner = new Spinner(
    {
      type: 'listening',
      text: `\n\n`,
      prefixText: `\n\nConnecting to Box CI Service `,
    },
    // don't change the message in case of API issues
    undefined,
  )

  setupSpinner.start()

  const cwd = process.cwd()

  // get the project level config, which does not change commit to commit,
  // at the start and keep it the same for the entire lifetime of the agent
  const projectConfig = getProjectConfig(cli, cwd)

  const { repoDir, logsDir } = await data.prepare(cwd)

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

  // poll for project builds until command exited
  while (true) {
    // prettier-ignore
    const waitingForBuildSpinner = new Spinner(
      {
        type: 'listening',
        text: `\n\n`,
        prefixText: `${printedProjectConfig}\n\n${Green('Listening for builds')} `,
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
      const logFile = new LogFile(buildLogFilePath(logsDir, projectBuild), 'INFO', waitingForBuildSpinner) // prettier-ignore
      const git = new Git(logFile)

      // clone the project at the commit specified in the projectBuild into the data dir
      const preparedForNewBuild = await data.prepareForNewBuild({
        projectConfig,
        git,
        repoDir,
        project,
        projectBuild,
        api,
        spinner: waitingForBuildSpinner,
      })

      // if could not prepare for this build, just skip to the next one
      if (!preparedForNewBuild) {
        break
      }

      // if projectBuild has no branch set, try to get the branch from the commit
      // and update the build with it if possible
      if (!projectBuild.gitBranch) {
        const gitBranches = await git.getBranchesForCommit(
          projectBuild.gitCommit,
        )

        waitingForBuildSpinner.stop()
        console.log('----', JSON.stringify(gitBranches))

        // only select a branch if there's only one option
        if (gitBranches.length === 1) {
          const gitBranch = gitBranches[0]
          projectBuild.gitBranch = gitBranch

          await api.setProjectBuildGitBranch({
            projectConfig,
            payload: {
              projectBuildId: projectBuild.id,
              gitBranch,
            },
            spinner: waitingForBuildSpinner,
            retries: DEFAULT_RETRIES,
          })
        }
      }

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
          projectConfig,
          payload: {
            projectBuildId: projectBuild.id,
            pipeline,
          },
          spinner: waitingForBuildSpinner,
          retries: DEFAULT_RETRIES,
        })

        waitingForBuildSpinner.stop(
          printedProjectConfig + printProjectBuild(projectConfig, projectBuild),
        )

        await runBuild({
          projectConfig,
          projectBuild,
          logFile,
          cwd: repoDir,
        })
      }
      // if no matching pipeline found, cancel the build
      else {
        await api.setProjectBuildNoMatchingPipeline({
          projectConfig,
          payload: { projectBuildId: projectBuild.id },
          spinner: waitingForBuildSpinner,
          retries: DEFAULT_RETRIES,
        })

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
