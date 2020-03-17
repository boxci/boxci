import fs from 'fs'
import api, { Project, ProjectBuild, DEFAULT_RETRIES } from './api'
import { LightBlue, Yellow } from './consoleFonts'
import { Git } from './git'
import { printErrorAndExit } from './logging'
import Spinner from './Spinner'
import { ProjectConfig } from './config'
import Logger from './Logger'

// TODO perhaps make this configurable
export const DATA_DIR_NAME = '.boxci'

export const LOGS_DIR_NAME = 'logs'
export const REPO_DIR_NAME = 'repo'

const LOCAL_GIT_IGNORE_FILE = '.git/info/exclude'

// this sets up the data directory structure if it doesn't already exist
export const prepare = (
  repoRootDir: string,
  spinner?: Spinner,
): { dataDir: string; repoDir: string; logsDir: string } => {
  const dataDir = `${repoRootDir}/${DATA_DIR_NAME}`
  const logsDir = `${dataDir}/${LOGS_DIR_NAME}`
  const repoDir = `${dataDir}/${REPO_DIR_NAME}`

  // create dataDir if it doesn't exist
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir)

      try {
        // ignore the directory in the local git repo
        fs.appendFileSync(
          `${repoRootDir}/${LOCAL_GIT_IGNORE_FILE}`,
          `\n${DATA_DIR_NAME}\n`,
        )
      } catch (err) {
        // prettier-ignore
        return printErrorAndExit(
          `Could not ignore directory ${dataDir} in local git repo\n\n` +
          `Tried to add the line ${Yellow(DATA_DIR_NAME)} to the file ${LOCAL_GIT_IGNORE_FILE} but got the error:\n\n${err}`,
          spinner
        )
      }
    } catch (err) {
      return printErrorAndExit(`Could not create directory ${dataDir}`, spinner)
    }
  }

  // create logsDir if it doesn't exist
  if (!fs.existsSync(logsDir)) {
    try {
      fs.mkdirSync(logsDir)
    } catch (err) {
      return printErrorAndExit(`Could not create directory ${logsDir}`, spinner)
    }
  }

  return {
    dataDir,
    repoDir,
    logsDir,
  }
}

// this prepares the data dir for a new build, checking
// out the specified branch / commit annd doing any cloning / setup
// of dirs if they don't exist
export const prepareForNewBuild = async ({
  projectConfig,
  git,
  repoDir,
  project,
  projectBuild,
  spinner,
  logger,
}: {
  projectConfig: ProjectConfig
  git: Git
  repoDir: string
  project: Project
  projectBuild: ProjectBuild
  spinner: Spinner
  logger: Logger
}): Promise<boolean> => {
  // if repoDir does not exist, clone the repo into it
  if (!fs.existsSync(repoDir)) {
    const repoCloned = await git.cloneRepo({ localPath: repoDir, project })

    if (repoCloned) {
      logger.writeEvent('INFO', `Cloned repository @ ${project.gitRepoSshUrl}`)
    } else {
      logger.writeEvent('ERROR', `Could not clone repository @ ${project.gitRepoSshUrl}`) // prettier-ignore

      return printErrorAndExit(
        `Could not clone repo ${LightBlue(project.gitRepoSshUrl)}`,
        spinner,
        logger.dir,
      )
    }
  }

  // make all git commands happen from repoDir
  git.setCwd(repoDir)

  // fetch the latest into the repo
  const fetchedRepo = await git.fetchRepoInCwd()
  if (fetchedRepo) {
    logger.writeEvent('INFO', `Fetched repository @ ${project.gitRepoSshUrl}`)
  } else {
    logger.writeEvent('ERROR', `Could not fetch repository @ ${project.gitRepoSshUrl}`) // prettier-ignore

    return printErrorAndExit(
      `Could not fetch from repo ${LightBlue(project.gitRepoSshUrl)}`,
      spinner,
      logger.dir,
    )
  }

  // checkout the commit specified in the build
  const checkoutOutCommit = await git.checkoutCommit(projectBuild.gitCommit)
  if (checkoutOutCommit) {
    logger.writeEvent('INFO', `Checked out commit ${projectBuild.gitCommit} from repository @ ${project.gitRepoSshUrl}`) // prettier-ignore
  } else {
    logger.writeEvent('ERROR', `Could not check out commit ${projectBuild.gitCommit} from repository @ ${project.gitRepoSshUrl}`) // prettier-ignore
    // if the checkout fails, we can assume the commit does not exist
    // (it might be on a branch which was deleted since the build was started
    // especially if the build was queued for a while)
    await api.setProjectBuildGitCommitNotFound({
      projectConfig,
      payload: {
        projectBuildId: projectBuild.id,
      },
      spinner,
      retries: DEFAULT_RETRIES,
    })

    // false signifies we should not continue with the build
    return false
  }

  // true signifies we should continue with the build
  return true
}
