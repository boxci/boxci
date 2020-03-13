import simplegit, { SimpleGit } from 'simple-git/promise'
import { Project } from './api'
import { LogFile, LogLevel, printErrorAndExit } from './logging'

export class Git {
  private git: SimpleGit
  private logFile: LogFile | undefined

  constructor(logFile?: LogFile) {
    this.git = simplegit()

    if (logFile) {
      this.logFile = logFile
    }
  }

  setLogFile = (logFile: LogFile) => {
    if (!this.logFile) {
      this.logFile = logFile
    }
  }

  private log(logLevel: LogLevel, str: string) {
    if (this.logFile) {
      this.logFile.writeLine(logLevel, str)
    } else {
      printErrorAndExit(
        `Could not write to logFile as it is not set:\n\n${logLevel}: ${str}`,
      )
    }
  }

  getVersion = async (): Promise<string | undefined> => {
    try {
      return (await this.git.raw(['version'])).trim()
    } catch {
      return
    }
  }

  getBranch = async (): Promise<string | undefined> => {
    try {
      return (await this.git.revparse(['--abbrev-ref', 'HEAD'])).trim()
    } catch {
      return
    }
  }

  getCommit = async (): Promise<string | undefined> => {
    try {
      return (await this.git.revparse(['HEAD'])).trim()
    } catch {
      return
    }
  }

  getBranchesForCommit = async (commit: string): Promise<Array<string>> => {
    try {
      return await (await this.git.branch({ '--contains': commit })).all
    } catch {
      return []
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
  // cloneRepoAtBranchAndCommit = async ({
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
  //     await this.git.clone(projectBuild.gitRepoUrl, localPath, [`--single-branch --branch ${projectBuild.gitBranch}`]) // prettier-ignore

  //     return true
  //   } catch (err) {
  //     this.log('ERROR', err)

  //     return false
  //   }
  // }

  cloneRepo = async ({
    localPath,
    project,
  }: {
    localPath: string
    project: Project
  }): Promise<boolean> => {
    try {
      await this.git.clone(project.gitRepoSshUrl, localPath)

      return true
    } catch (err) {
      this.log('ERROR', err)

      return false
    }
  }

  fetchRepoInCwd = async (): Promise<boolean> => {
    try {
      await this.git.fetch()

      return true
    } catch (err) {
      this.log('ERROR', err)

      return false
    }
  }

  checkoutCommit = async (commit: string): Promise<boolean> => {
    try {
      await this.git.checkout(commit)

      return true
    } catch (err) {
      this.log('ERROR', err)

      return false
    }
  }

  setCwd = async (dir: string): Promise<boolean> => {
    try {
      await this.git.cwd(dir)

      return true
    } catch (err) {
      this.log('ERROR', err)

      return false
    }
  }
}
