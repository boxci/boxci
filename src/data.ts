import fs from 'fs'
import rimraf from 'rimraf'
import { Spinner } from './Spinner'
import { printErrorAndExit, LogFile } from './logging'
import * as git from './git'
import { ProjectBuild } from './api'
import { LightBlue, Underline } from './consoleFonts'

// TODO perhaps make this configurable
export const DATA_DIR_NAME = '.boxci'

export const REPO_DIR_NAME = 'repo'

// this prepares the data dir for a new build, checking
// out the specified branch / commit annd doing any cloning / setup
// of dirs if they don't exist
export const prepareForNewBuild = async (
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

      if (!(await git.cloneRepo({ localPath: repoDir, projectBuild }))) {
        return printErrorAndExit(`Could not clone repo ${LightBlue(Underline(projectBuild.gitRepoUrl))} into ${repoDir}`) // prettier-ignore
      }
    } catch (err) {
      if (spinner) {
        spinner.stop()
      }

      return printErrorAndExit(`Could not create directory ${repoDir}`)
    }
  }

  // fetch the latest into the repo
  const cwd = process.cwd()
  process.chdir(repoDir)
  git.fetchRepoInCwd()
  process.chdir(cwd)

  // checkout the commit specified in the build
  git.checkoutCommit(projectBuild.gitCommit)

  return { dataDir, repoDir }
}
