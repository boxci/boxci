import simplegit from 'simple-git/promise'
import { ProjectBuild } from './api'
import { LogFile } from './logging'

const git = simplegit()

// the name of the origin remote to use
// TODO maybe in future make this configurable
// but for now just hard code to the conventional 'origin'
const ORIGIN = 'origin'

const ORIGIN_BRANCH_PREFIX = `${ORIGIN}/`
const ORIGIN_BRANCH_PREFIX_LENGTH = ORIGIN_BRANCH_PREFIX.length

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

// Want to clone the repo at a specific branch and commit in the most efficient way possible
// (i.e. just the code at that branch/commit, no other branches, no history)
//
// The most widely supported way to do this is by doing a shallow clone of the specific
// branch, and then checking out the commit. This means no other branches are downloaded
// but you do get full history of the branch you clone. This has been supported since
// git 1.7.10 which was released in 2012, so it's reasonable to put that as a minimum
// required version of git for use with boxci
//
// The other way is via fetching a specific commit, but it's only supported in later
// versions of git and has to be explicitly enabled on the remote repo
// TODO for future is to enable this for specific providers where it's supported
// based on the hostname of the repo, to enable it where possible
export const cloneRepoAtBranchAndCommit = async (
  {
    localPath,
    projectBuild,
  }: {
    localPath: string
    projectBuild: ProjectBuild
  },
  logFile: LogFile,
): Promise<boolean> => {
  try {
    // implements this git command
    //
    // git clone --single-branch --branch {projectBuild.gitBranch} {projectBuild.gitRepoUrl}
    await git.clone(projectBuild.gitRepoUrl, localPath, [`--single-branch --branch ${projectBuild.gitBranch}`]) // prettier-ignore

    return true
  } catch (err) {
    logFile.writeLine('ERROR', err)

    return false
  }
}

export const cloneRepo = async (
  {
    localPath,
    projectBuild,
  }: {
    localPath: string
    projectBuild: ProjectBuild
  },
  logFile: LogFile,
): Promise<boolean> => {
  try {
    await git.clone(projectBuild.gitRepoUrl, localPath)

    return true
  } catch (err) {
    logFile.writeLine('ERROR', err)

    return false
  }
}

export const fetchRepoInCwd = async (logFile: LogFile): Promise<boolean> => {
  try {
    await git.fetch()

    return true
  } catch (err) {
    logFile.writeLine('ERROR', err)

    return false
  }
}

export const checkoutCommit = async (
  commit: string,
  logFile: LogFile,
): Promise<boolean> => {
  try {
    await git.checkout(commit)

    return true
  } catch (err) {
    logFile.writeLine('ERROR', err)

    return false
  }
}

export const setCwd = async (
  dir: string,
  logFile: LogFile,
): Promise<boolean> => {
  try {
    await git.cwd(dir)

    return true
  } catch (err) {
    logFile.writeLine('ERROR', err)

    return false
  }
}
