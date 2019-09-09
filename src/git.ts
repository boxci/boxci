import simplegit from 'simple-git/promise'
import { Project } from './api'
import BuildLogger from './BuildLogger'

const git = simplegit()

const GIT_COMMAND_FAILED = 'git command failed:'

export default {
  getVersion: async ({
    buildLogger,
  }: {
    buildLogger?: BuildLogger
  }): Promise<string | undefined> => {
    try {
      return (await git.raw(['version'])).trim()
    } catch (err) {
      buildLogger?.writeError(`${GIT_COMMAND_FAILED} git --version`, err) // prettier-ignore
      return
    }
  },

  getBranch: async ({
    buildLogger,
  }: {
    buildLogger?: BuildLogger
  }): Promise<string | undefined> => {
    try {
      return (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()
    } catch (err) {
      buildLogger?.writeError(`${GIT_COMMAND_FAILED} git rev-parse --abbrev-ref HEAD`, err) // prettier-ignore
      return
    }
  },

  getCommit: async ({
    buildLogger,
  }: {
    buildLogger?: BuildLogger
  }): Promise<string | undefined> => {
    try {
      return (await git.revparse(['HEAD'])).trim()
    } catch (err) {
      buildLogger?.writeError(`${GIT_COMMAND_FAILED} git rev-parse HEAD`, err) // prettier-ignore
      return
    }
  },

  getBranchesForCommit: async ({
    commit,
    buildLogger,
  }: {
    commit: string
    buildLogger?: BuildLogger
  }): Promise<Array<string>> => {
    try {
      return await (await git.branch({ '--contains': commit })).all
    } catch (err) {
      buildLogger?.writeError(`${GIT_COMMAND_FAILED} git branch --contains ${commit}`, err) // prettier-ignore
      return []
    }
  },

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
  // cloneRepoAtBranchAndCommit : async ({
  //   localPath,
  //   projectBuild,
  // }: {
  //   localPath: string
  //   projectBuild: ProjectBuild
  // }): Promise<boolean> => {
  //   try {
  //     // implements this git command
  //     //
  //     // git clone --single-branch --branch {projectBuild.gitBranch} {projectBuild.gitRepoUrl}
  //     await git.clone(projectBuild.gitRepoUrl, localPath, [`--single-branch --branch ${projectBuild.gitBranch}`]) // prettier-ignore

  //     return true
  //   } catch (err) {
  //     this.log('ERROR', err)

  //     return false
  //   }
  // }

  cloneRepo: async ({
    localPath,
    project,
    buildLogger,
  }: {
    localPath: string
    project: Project
    buildLogger?: BuildLogger
  }): Promise<boolean> => {
    try {
      await git.clone(project.gitRepoSshUrl, localPath)

      return true
    } catch (err) {
      buildLogger?.writeError(`${GIT_COMMAND_FAILED} git clone ${project.gitRepoSshUrl}`, err) // prettier-ignore
      return false
    }
  },

  fetchRepoInCwd: async ({
    buildLogger,
  }: {
    buildLogger?: BuildLogger
  }): Promise<boolean> => {
    try {
      await git.fetch()

      return true
    } catch (err) {
      buildLogger?.writeError(`${GIT_COMMAND_FAILED} git fetch`, err) // prettier-ignore
      return false
    }
  },

  checkoutCommit: async ({
    commit,
    buildLogger,
  }: {
    commit: string
    buildLogger?: BuildLogger
  }): Promise<boolean> => {
    try {
      await git.checkout(commit)

      return true
    } catch (err) {
      buildLogger?.writeError(`${GIT_COMMAND_FAILED} git checkout ${commit}`, err) // prettier-ignore
      return false
    }
  },

  setCwd: async ({
    dir,
    buildLogger,
  }: {
    dir: string
    buildLogger?: BuildLogger
  }): Promise<boolean> => {
    try {
      await git.cwd(dir)

      return true
    } catch (err) {
      buildLogger?.writeError(`Could not set git cwd to ${dir}`, err)
      return false
    }
  },
}
