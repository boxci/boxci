import fs from 'fs'
import { Spinner } from './Spinner'
import { printErrorAndExit, LogFile } from './logging'
import { Git } from './git'
import { ProjectBuild, Project } from './api'
import { LightBlue, Underline, Green, Yellow } from './consoleFonts'
import { log } from 'util'

// TODO perhaps make this configurable
export const DATA_DIR_NAME = '.boxci'

export const LOGS_DIR_NAME = 'logs'
export const REPO_DIR_NAME = 'repo'

const LOCAL_GIT_IGNORE_FILE = '.git/info/exclude'

// this sets up the data directory structure if it doesn't already exist
export const prepare = async (
  repoRootDir: string,
  spinner?: Spinner,
): Promise<{ dataDir: string; repoDir: string; logsDir: string }> => {
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
export const prepareForNewBuild = async (
  git: Git,
  repoDir: string,
  project: Project,
  projectBuild: ProjectBuild,
  spinner?: Spinner,
): Promise<void> => {
  // if repoDir does not exist, clone the repo into it
  if (!fs.existsSync(repoDir)) {
    if (!(await git.cloneRepo({ localPath: repoDir, project }))) {
      return printErrorAndExit(
        `Could not clone repo ${LightBlue(project.gitRepoSshUrl)}`,
        spinner,
      )
    }
  }

  // make all git commands happen from repoDir
  git.setCwd(repoDir)

  // fetch the latest into the repo
  if (!(await git.fetchRepoInCwd())) {
    return printErrorAndExit(
      `Could not fetch from repo ${LightBlue(project.gitRepoSshUrl)}`,
      spinner,
    )
  }

  // checkout the commit specified in the build
  if (!(await git.checkoutCommit(projectBuild.gitCommit))) {
    return printErrorAndExit(
      `Could not find commit ` +
        `${Yellow(projectBuild.gitCommit)} ` +
        `in repo ` +
        `${LightBlue(project.gitRepoSshUrl)}`,
      spinner,
    )
  }
}
