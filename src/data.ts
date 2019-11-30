import fs from 'fs'
import { Spinner } from './Spinner'
import { printErrorAndExit, LogFile } from './logging'
import * as git from './git'
import { ProjectBuild } from './api'
import { LightBlue, Underline, Green, Yellow } from './consoleFonts'
import { log } from 'util'

// TODO perhaps make this configurable
export const DATA_DIR_NAME = '.boxci'

export const LOGS_DIR_NAME = 'logs'
export const REPO_DIR_NAME = 'repo'

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
    } catch (err) {
      if (spinner) {
        spinner.stop()
      }

      return printErrorAndExit(`Could not create directory ${dataDir}`)
    }
  }

  // create logsDir if it doesn't exist
  if (!fs.existsSync(logsDir)) {
    try {
      fs.mkdirSync(logsDir)
    } catch (err) {
      if (spinner) {
        spinner.stop()
      }

      return printErrorAndExit(`Could not create directory ${logsDir}`)
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
  logFile: LogFile,
  repoDir: string,
  projectBuild: ProjectBuild,
  spinner?: Spinner,
): Promise<void> => {
  // if repoDir does not exist, clone the repo into it
  if (!fs.existsSync(repoDir)) {
    if (!(await git.cloneRepo({ localPath: repoDir, projectBuild }, logFile))) {
      if (spinner) {
        spinner.stop()
      }

      return printErrorAndExit(`Could not clone from ${Green('origin')} ${LightBlue(Underline(projectBuild.gitRepoUrl))}`) // prettier-ignore
    }
  }

  // switch into repoDir
  const cwd = process.cwd()

  // TODO need to make git a non-global because of this
  git.setCwd(repoDir, logFile)

  // fetch the latest into the repo
  if (!(await git.fetchRepoInCwd(logFile))) {
    if (spinner) {
      spinner.stop()
    }

    return printErrorAndExit(`Could not fetch from ${Green('origin')} ${LightBlue(Underline(projectBuild.gitRepoUrl))}`) // prettier-ignore
  }

  // checkout the commit specified in the build
  if (!(await git.checkoutCommit(projectBuild.gitCommit, logFile))) {
    if (spinner) {
      spinner.stop()
    }

    return printErrorAndExit(`Could not checkout commit ${Yellow(projectBuild.gitCommit)} from ${Green('origin')} ${LightBlue(Underline(projectBuild.gitRepoUrl))}`) // prettier-ignore
  }

  // switch back to previous dir
  git.setCwd(cwd, logFile)
}
