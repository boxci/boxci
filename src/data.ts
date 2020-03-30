import fs from 'fs'
import api, { Project, ProjectBuild, DEFAULT_RETRIES } from './api'
import { LightBlue, Yellow } from './consoleFonts'
import git from './git'
import { printErrorAndExit } from './logging'
import Spinner from './Spinner'
import { ProjectConfig } from './config'
import BuildLogger from './BuildLogger'

// TODO perhaps make this configurable
export const DATA_DIR_NAME = '.boxci'

export const LOGS_DIR_NAME = 'logs'
export const REPO_DIR_NAME = 'repo'

const createDirIfDoesNotExist = (path: string) => {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path)
  }
}

// this sets up the data directory structure if it doesn't already exist
export const setupBoxCiDirs = ({
  rootDir,
  spinner,
}: {
  rootDir: string
  spinner: Spinner
}): string => {
  const dataDir = `${rootDir}/${DATA_DIR_NAME}`
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir)
    }
  } catch (err) {
    printErrorAndExit(`Could not create Box CI data directory @ ${Yellow(dataDir)}\n\nCause:\n\n${err}\n\n`, spinner) // prettier-ignore
  }

  const logsDir = `${dataDir}/${LOGS_DIR_NAME}`
  try {
    createDirIfDoesNotExist(logsDir)
  } catch (err) {
    printErrorAndExit(`Could not create Box CI logs directory @ ${Yellow(logsDir)}\n\nCause:\n\n${err}\n\n`, err) // prettier-ignore
  }

  return dataDir
}

// this prepares the data dir for a new build
// - does any cloning / setup
// of dirs if they don't exist

// - check out specified commit  d
export const prepareForNewBuild = async ({
  projectConfig,
  dataDir,
  project,
  projectBuild,
  buildLogger,
}: {
  projectConfig: ProjectConfig
  dataDir: string
  project: Project
  projectBuild: ProjectBuild
  buildLogger: BuildLogger
}): Promise<{ repoDir: string; consoleErrorMessage?: string }> => {
  const repoDir = `${dataDir}/${REPO_DIR_NAME}`

  // if repoDir does not exist, clone the repo into it
  if (!fs.existsSync(repoDir)) {
    const repoCloned = await git.cloneRepo({ localPath: repoDir, project })

    if (repoCloned) {
      buildLogger.writeEvent('INFO', `Cloned repository ${project.gitRepoSshUrl}`) // prettier-ignore
    } else {
      buildLogger.writeEvent('ERROR', `Could not clone repository ${project.gitRepoSshUrl}`) // prettier-ignore

      try {
        await api.setProjectBuildErrorCloningRepository({
          projectConfig,
          payload: {
            projectBuildId: projectBuild.id,
            gitRepoSshUrl: project.gitRepoSshUrl,
          },
          spinner: undefined,
          retries: DEFAULT_RETRIES,
        })
      } catch (err) {
        // log and ignore any errors here, build will just show as timed out instead
        buildLogger.writeError(`Could not set error cloning repository on server`, err) // prettier-ignore
      }

      return {
        repoDir,
        consoleErrorMessage: `Could not clone repository ${LightBlue(project.gitRepoSshUrl)}` // prettier-ignore
      }
    }
  }

  // make all git commands happen from repoDir
  const setCwd = git.setCwd({ dir: repoDir, buildLogger })

  if (!setCwd) {
    const errorMessage = `Could not set git working directory to repository directory ${repoDir}`
    buildLogger.writeEvent('ERROR', errorMessage)

    try {
      await api.setProjectBuildErrorPreparing({
        projectConfig,
        payload: {
          projectBuildId: projectBuild.id,
          errorMessage,
        },
        spinner: undefined,
        retries: DEFAULT_RETRIES,
      })
    } catch (err) {
      // log and ignore any errors here, build will just show as timed out instead
      buildLogger.writeError(`Could not set error cloning repository on server`, err) // prettier-ignore
    }

    return {
      repoDir,
      consoleErrorMessage: `Could not set git working directory to repository directory @ ${LightBlue(project.gitRepoSshUrl)}` // prettier-ignore
    }
  }

  // fetch the latest into the repo
  const fetchedRepo = await git.fetchRepoInCwd({ buildLogger })
  if (fetchedRepo) {
    buildLogger.writeEvent('INFO', `Fetched repository ${project.gitRepoSshUrl}`) // prettier-ignore
  } else {
    buildLogger.writeEvent('ERROR', `Could not fetch repository ${project.gitRepoSshUrl}`) // prettier-ignore

    try {
      await api.setProjectBuildErrorFetchingRepository({
        projectConfig,
        payload: {
          projectBuildId: projectBuild.id,
          gitRepoSshUrl: project.gitRepoSshUrl,
        },
        spinner: undefined,
        retries: DEFAULT_RETRIES,
      })
    } catch (err) {
      // log and ignore any errors here, build will just show as timed out instead
      buildLogger.writeError(`Could not set error fetching repository on server`, err) // prettier-ignore
    }

    return {
      repoDir,
      consoleErrorMessage: `Could not fetch repository ${LightBlue(project.gitRepoSshUrl)}` // prettier-ignore
    }
  }

  // checkout the commit specified in the build
  const checkoutOutCommit = await git.checkoutCommit({
    commit: projectBuild.gitCommit,
    buildLogger,
  })

  if (checkoutOutCommit) {
    buildLogger.writeEvent('INFO', `Checked out commit ${projectBuild.gitCommit} from repository @ ${project.gitRepoSshUrl}`) // prettier-ignore
  } else {
    buildLogger.writeEvent('ERROR', `Could not check out commit ${projectBuild.gitCommit} from repository @ ${project.gitRepoSshUrl}`) // prettier-ignore

    try {
      // if the checkout fails, we can assume the commit does not exist
      // (it might be on a branch which was deleted since the build was started
      // especially if the build was queued for a while)
      await api.setProjectBuildErrorGitCommitNotFound({
        projectConfig,
        payload: {
          projectBuildId: projectBuild.id,
          gitRepoSshUrl: project.gitRepoSshUrl,
        },
        spinner: undefined,
        retries: DEFAULT_RETRIES,
      })
    } catch (err) {
      buildLogger.writeError(`Could not set commit not found on server`, err)
    }

    return {
      repoDir,
      consoleErrorMessage: `Could not check out commit ${Yellow(projectBuild.gitCommit)} from repository @ ${LightBlue(project.gitRepoSshUrl)}` // prettier-ignore
    }
  }

  return {
    repoDir,
  }
}
