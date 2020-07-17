import fs from 'fs'
import api, {
  DEFAULT_RETRIES,
  Project,
  ProjectBuild,
  ProjectBuildPipeline,
} from './api'
import BuildLogger from './BuildLogger'
import {
  AgentConfig,
  ProjectBuildConfig,
  readProjectBuildConfig,
} from './config'
import { LightBlue, Red, Yellow } from './consoleFonts'
import git from './git'
import Spinner from './Spinner'

export default class BuildRunner {
  private projectBuild: ProjectBuild
  private project: Project
  private agentConfig: AgentConfig
  private agentMetaDir: string
  private buildLogger: BuildLogger
  private buildStartedMessage: string
  private waitingForBuildSpinner: Spinner

  constructor({
    agentConfig,
    projectBuild,
    agentMetaDir,
    project,
    buildLogger,
    buildStartedMessage,
    waitingForBuildSpinner,
  }: {
    agentConfig: AgentConfig
    projectBuild: ProjectBuild
    agentMetaDir: string
    project: Project
    buildLogger: BuildLogger
    buildStartedMessage: string
    waitingForBuildSpinner: Spinner
  }) {
    this.project = project
    this.agentConfig = agentConfig
    this.projectBuild = projectBuild
    this.agentMetaDir = agentMetaDir
    this.buildLogger = buildLogger
    this.buildStartedMessage = buildStartedMessage
    this.waitingForBuildSpinner = waitingForBuildSpinner
  }

  // does the setup to run the build
  // this won't throw, but if it returns false it means an error happened which
  // means we can't continue to run the build and just need to fail it
  public async prepareBuildAndGetPipeline(): Promise<
    ProjectBuildPipeline | undefined
  > {
    this.buildLogger.writeEvent('INFO', `Preparing build ${this.projectBuild.id}`) // prettier-ignore

    const stopSpinnerWithErrorMessage = (message: string) => {
      this.waitingForBuildSpinner.stop(
        this.buildStartedMessage +
          '\n\n' +
          Red('Error preparing build') +
          `\n\n${message}\n\n`,
      )
    }

    const repoDir = `${this.agentMetaDir}/repo`

    // if repoDir does not exist yet, it means we need to clone the repo
    if (!fs.existsSync(repoDir)) {
      const repoCloned = await git.cloneRepo({
        localPath: repoDir,
        project: this.project,
      })

      if (repoCloned) {
        this.buildLogger.writeEvent('INFO', `Cloned repository ${this.project.gitRepoSshUrl}`) // prettier-ignore
      } else {
        this.buildLogger.writeEvent('ERROR', `Could not clone repository ${this.project.gitRepoSshUrl}`) // prettier-ignore

        try {
          await api.setProjectBuildErrorCloningRepository({
            agentConfig: this.agentConfig,
            payload: {
              projectBuildId: this.projectBuild.id,
              gitRepoSshUrl: this.project.gitRepoSshUrl,
            },
            spinner: undefined,
            retries: DEFAULT_RETRIES,
          })
        } catch (err) {
          // log and ignore any errors here, build will just show as timed out instead
          this.buildLogger.writeError(`Could not set error cloning repository on server`, err) // prettier-ignore
        }

        stopSpinnerWithErrorMessage(`Could not clone repository ${LightBlue(this.project.gitRepoSshUrl)}`) // prettier-ignore

        // if there was an error, don't run the build
        // but don't exit - just continue and wait for the next build
        return
      }
    }

    // make all git commands happen from repoDir
    const setCwd = git.setCwd({
      dir: repoDir,
      buildLogger: this.buildLogger,
    })

    // if there was a problem doing this, exit with error
    if (!setCwd) {
      const errorMessage = `Could not set git working directory to repository directory ${repoDir}`
      this.buildLogger.writeEvent('ERROR', errorMessage)

      try {
        await api.setProjectBuildErrorPreparing({
          agentConfig: this.agentConfig,
          payload: {
            projectBuildId: this.projectBuild.id,
            errorMessage,
          },
          spinner: undefined,
          retries: DEFAULT_RETRIES,
        })
      } catch (err) {
        // log and ignore any errors here, build will just show as timed out instead
        this.buildLogger.writeError(`Could not set error cloning repository on server`, err) // prettier-ignore
      }

      stopSpinnerWithErrorMessage(`Could not set git working directory to repository directory @ ${LightBlue(this.project.gitRepoSshUrl)}`) // prettier-ignore

      // if there was an error, don't run the build
      // but don't exit - just continue and wait for the next build
      return
    }

    // at this point we know the repo is present, so fetch the latest
    const fetchedRepo = await git.fetchRepoInCwd({
      buildLogger: this.buildLogger,
    })

    if (fetchedRepo) {
      this.buildLogger.writeEvent('INFO', `Fetched repository ${this.project.gitRepoSshUrl}`) // prettier-ignore
    } else {
      this.buildLogger.writeEvent('ERROR', `Could not fetch repository ${this.project.gitRepoSshUrl}`) // prettier-ignore

      try {
        await api.setProjectBuildErrorFetchingRepository({
          agentConfig: this.agentConfig,
          payload: {
            projectBuildId: this.projectBuild.id,
            gitRepoSshUrl: this.project.gitRepoSshUrl,
          },
          spinner: undefined,
          retries: DEFAULT_RETRIES,
        })
      } catch (err) {
        // log and ignore any errors here, build will just show as timed out instead
        this.buildLogger.writeError(`Could not set error fetching repository on server`, err) // prettier-ignore
      }

      stopSpinnerWithErrorMessage(`Could not fetch repository ${LightBlue(this.project.gitRepoSshUrl)}`) // prettier-ignore

      // if there was an error, don't run the build
      // but don't exit - just continue and wait for the next build
      return
    }

    // now checkout the commit specified in the build
    const checkoutOutCommit = await git.checkoutCommit({
      commit: this.projectBuild.gitCommit,
      buildLogger: this.buildLogger,
    })

    if (checkoutOutCommit) {
      this.buildLogger.writeEvent('INFO', `Checked out commit ${this.projectBuild.gitCommit} from repository @ ${this.project.gitRepoSshUrl}`) // prettier-ignore
    }
    // if there is an error, exit
    else {
      this.buildLogger.writeEvent('ERROR', `Could not check out commit ${this.projectBuild.gitCommit} from repository @ ${this.project.gitRepoSshUrl}`) // prettier-ignore

      try {
        // if the checkout fails, we can assume the commit does not exist
        // (it might be on a branch which was deleted since the build was started
        // especially if the build was queued for a while)
        await api.setProjectBuildErrorGitCommitNotFound({
          agentConfig: this.agentConfig,
          payload: {
            projectBuildId: this.projectBuild.id,
            gitRepoSshUrl: this.project.gitRepoSshUrl,
          },
          spinner: undefined,
          retries: DEFAULT_RETRIES,
        })
      } catch (err) {
        this.buildLogger.writeError(
          `Could not set commit not found on server`,
          err,
        )
      }

      stopSpinnerWithErrorMessage(`Could not check out commit ${Yellow(this.projectBuild.gitCommit)} from repository @ ${LightBlue(this.project.gitRepoSshUrl)}`) // prettier-ignore

      // if there was an error, don't run the build
      // but don't exit - just continue and wait for the next build
      return
    }

    this.buildLogger.writeEvent('INFO', `Reading config for build ${this.projectBuild.id}`) // prettier-ignore

    const {
      projectBuildConfig,
      configFileName,
      validationErrors,
      configFileError,
    } = readProjectBuildConfig({ dir: repoDir })

    let errorPreparingBecauseOfConfig: string = ''

    if (configFileError !== undefined) {
      this.buildLogger.writeEvent('ERROR', `Could not read config for build ${this.projectBuild.id}. Cause: ${configFileError}`) // prettier-ignore
      this.waitingForBuildSpinner.stop(
        this.buildStartedMessage + '\n\n' + configFileError,
      )

      errorPreparingBecauseOfConfig = configFileError
    } else if (validationErrors !== undefined) {
      const errorMessage = validationErrors.join('\n')
      this.buildLogger.writeEvent('ERROR', `Errors in config for build ${this.projectBuild.id}:\n${errorMessage}`) // prettier-ignore

      this.waitingForBuildSpinner.stop(
        this.buildStartedMessage +
          `\n\n` +
          `Config errors in ${configFileName}\n` +
          `${errorMessage}\n\n` +
          `Run ${Yellow('boxci help')} for more info on config options\n\n`,
      )

      errorPreparingBecauseOfConfig = errorMessage
    } else if (projectBuildConfig === undefined) {
      this.buildLogger.writeEvent('ERROR', `Could not read config for build ${this.projectBuild.id}`) // prettier-ignore
      this.waitingForBuildSpinner.stop(
        this.buildStartedMessage + `\n\n` + `Could not read build config\n`,
      )

      errorPreparingBecauseOfConfig = 'Could not read build config'
    }

    // if there was a config error, set it on the build on the server and continue to listen for next build
    if (errorPreparingBecauseOfConfig !== '') {
      try {
        await api.setProjectBuildErrorPreparing({
          agentConfig: this.agentConfig,
          payload: {
            projectBuildId: this.projectBuild.id,
            errorMessage: errorPreparingBecauseOfConfig,
          },
          spinner: undefined,
          retries: DEFAULT_RETRIES,
        })
        this.buildLogger.writeEvent('INFO', `Successfully set config error on server for build ${this.projectBuild.id}`) // prettier-ignore
      } catch (err) {
        // if any errors happen here, ignore them, build will just time out
        this.buildLogger.writeError(`Could not config error on server for build ${this.projectBuild.id}`, err) // prettier-ignore
      }

      return
    }

    // reruns of old builds already have a pipeline set
    // so no need to find the pipeline again as we already have it
    if (this.projectBuild.pipeline !== undefined) {
      this.buildLogger.writeEvent('INFO', `Pipeline already set on build ${this.projectBuild.id} (it is a rerun of build ${this.projectBuild.rerunId})`) // prettier-ignore

      this.waitingForBuildSpinner.stop(this.buildStartedMessage)

      return this.projectBuild.pipeline
    }

    this.buildLogger.writeEvent('INFO', `Finding pipeline for build ${this.projectBuild.id} in config`) // prettier-ignore

    // try to match a pipeline in the project build config to the ref for this commit
    const pipeline: ProjectBuildPipeline | undefined = getProjectBuildPipeline(
      this.projectBuild,
      // TS can't tell that projectBuildConfig must be defined here from if statement above
      projectBuildConfig!,
    )

    // if no pipeline found, we send the build skipped event, show in the cli output, and continue to listen for next build
    if (pipeline === undefined) {
      this.buildLogger.writeEvent(
        'INFO',
        `No pipeline matches ref for build ${this.projectBuild.id} ` +
          `(commit ${this.projectBuild.gitCommit}, ` +
          `branch ${this.projectBuild.gitBranch ?? '[none]'}, ` +
          `tag ${this.projectBuild.gitTag ?? '[none]'})`,
      )

      this.buildLogger.writeEvent(
        'INFO',
        `Setting no pipeline matched on server for build ${this.projectBuild.id}`,
      )

      try {
        await api.setProjectBuildNoMatchingPipeline({
          agentConfig: this.agentConfig,
          payload: {
            projectBuildId: this.projectBuild.id,
          },
          spinner: undefined,
          retries: DEFAULT_RETRIES,
        })
        this.buildLogger.writeEvent('INFO', `Successfully set no pipeline matched on server for build ${this.projectBuild.id}`) // prettier-ignore
      } catch (err) {
        // if any errors happen here, ignore them, build will just time out
        this.buildLogger.writeError(`Could not set no pipeline matched on server for build ${this.projectBuild.id}`, err) // prettier-ignore
      }

      // print no message for no matching pipeline
      // it's not an error, just continue listening for other builds
      this.waitingForBuildSpinner.stop()

      return
    }

    this.buildLogger.writeEvent('INFO', `Matched pipeline [${pipeline.n}] with tasks [${pipeline.t.map(t => t.n).join(', ')}] for build ${this.projectBuild.id} at commit ${this.projectBuild.gitCommit}`) // prettier-ignore

    try {
      await api.setProjectBuildPipeline({
        agentConfig: this.agentConfig,
        payload: {
          projectBuildId: this.projectBuild.id,
          pipeline,
        },
        spinner: undefined,
        retries: DEFAULT_RETRIES,
      })
      this.buildLogger.writeEvent('INFO', `Successfully set pipeline on server for build ${this.projectBuild.id}`) // prettier-ignore
    } catch (err) {
      // if any errors happen here, ignore them and return false, build will just time out
      this.buildLogger.writeError(`Could not set pipleine on server for build ${this.projectBuild.id}`, err) // prettier-ignore

      return
    }

    this.waitingForBuildSpinner.stop(this.buildStartedMessage)

    return pipeline
  }
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
