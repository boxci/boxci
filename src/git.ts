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
