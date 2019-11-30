import fs from 'fs'
import { Spinner } from './Spinner'
import { printErrorAndExit, LogFile } from './logging'
import * as git from './git'
import { ProjectBuild } from './api'
import { LightBlue, Underline } from './consoleFonts'

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
  repoRootDir: string,
  projectBuild: ProjectBuild,
  spinner?: Spinner,
): Promise<{ dataDir: string; repoDir: string }> => {
  const dataDir = `${repoRootDir}/${DATA_DIR_NAME}`
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

  // clone repo if it doesn't exist
  if (!fs.existsSync(repoDir)) {
    try {
      fs.mkdirSync(repoDir)

      if (
        !(await git.cloneRepo({ localPath: repoDir, projectBuild }, logFile))
      ) {
        return printErrorAndExit(`Could not clone repo ${LightBlue(Underline(projectBuild.gitRepoUrl))} into ${repoDir}`) // prettier-ignore
      }
    } catch (err) {
      if (spinner) {
        spinner.stop()
      }

      return printErrorAndExit(`Could not create directory ${repoDir}`)
    }
  }

  // switch into repoDir
  const cwd = process.cwd()
  process.chdir(repoDir)

  // fetch the latest into the repo
  await git.fetchRepoInCwd(logFile)

  // checkout the commit specified in the build
  await git.checkoutCommit(projectBuild.gitCommit, logFile)

  // switch back to previous dir
  process.chdir(cwd)

  return { dataDir, repoDir }
}
