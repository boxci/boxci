import simplegit from 'simple-git/promise'
import { ProjectBuild } from './api'

const git = simplegit()

// the name of the origin remote to use
// TODO maybe in future make this configurable
// but for now just hard code to the conventional 'origin'
const ORIGIN = 'origin'

// name of the directory to clone code to be built into
// TODO maybe in future make this configurable
// but for now just hardcode
const DATA_DIRECTORY_NAME = '.boxci'

export const checkInstalled = async (): Promise<boolean> => {
  // first, check git is installed and error and exit if not
  try {
    await git.status()

    return true
  } catch {
    return false
  }
}

export const getVersion = async (): Promise<string | undefined> => {
  try {
    return (await git.raw(['version'])).trim()
  } catch {
    return
  }
}

export const getOrigin = async (): Promise<string | undefined> => {
  try {
    return (await git.raw(['config', '--get', `remote.${ORIGIN}.url`])).trim()
  } catch {
    return
  }
}

export const getBranch = async (): Promise<string | undefined> => {
  try {
    return (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()
  } catch (err) {
    return
  }
}

export const getCommit = async (): Promise<string | undefined> => {
  try {
    return (await git.revparse(['HEAD'])).trim()
  } catch (err) {
    return
  }
}

export const getRepoRootDirectory = async (): Promise<string | undefined> => {
  try {
    return (await git.revparse(['--show-toplevel'])).trim()
  } catch {
    return
  }
}

const ORIGIN_BRANCH_PREFIX = `${ORIGIN}/`
const ORIGIN_BRANCH_PREFIX_LENGTH = ORIGIN_BRANCH_PREFIX.length

export const existsInOrigin = async ({
  branch,
  commit,
}: {
  branch: string
  commit: string
}): Promise<boolean> => {
  try {
    const { all } = await git.branch(['-r', '--contains', commit])

    const remoteBranchWithCommit = all.find((branchNameFull) => {
      if (branchNameFull.startsWith(ORIGIN_BRANCH_PREFIX)) {
        return branch === branchNameFull.substring(ORIGIN_BRANCH_PREFIX_LENGTH)
      }

      return false
    })

    return !!remoteBranchWithCommit
  } catch {
    return false
  }
}

export const cloneRepoIntoDirectory = async (
  dir: string,
  projectBuild: ProjectBuild,
): Promise<boolean> => {
  try {
    console.log(projectBuild.gitRepoUrl)
    await git.clone(projectBuild.gitRepoUrl, '.boxci')

    return true
  } catch (err) {
    console.log(err)
    return false
  }
}
export const commitShort = (gitCommit: string) => gitCommit.substr(0, 7)
