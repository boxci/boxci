import fs from 'fs'
import path from 'path'
import api, { Project, ProjectBuild, DEFAULT_RETRIES } from './api'
import { LightBlue, Yellow } from './consoleFonts'
import git from './git'
import { printErrorAndExit } from './logging'
import Spinner from './Spinner'
import { AgentConfig } from './config'
import BuildLogger from './BuildLogger'
import { getCurrentTimeStamp } from './util'

export const LOGS_DIR_NAME = 'logs'
export const REPO_DIR_NAME = 'repo'

const createDirIfDoesNotExist = (path: string) => {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path)
  }
}

// gets the machine level boxci directory in a platform agnostic way
// should work on baically any UNIX or windows
const getBoxCiDir = ({
  spinner,
  failSilently,
}: {
  spinner: Spinner | undefined
  failSilently?: boolean
}) => {
  const platform = process.platform
  const isWindows = platform === 'win32'
  const homeDirEnvVar = isWindows ? 'USERPROFILE' : 'HOME'
  const homeDir = process.env[homeDirEnvVar]

  if (!homeDir) {
    if (failSilently) {
      // handle failure in parent
      return ''
    }

    printErrorAndExit(`Could not identify the home directory on this operating system (${platform}) - tried to locate it with the environment variable ${homeDirEnvVar} but no value is set`, spinner) // prettier-ignore
  }

  const boxCiDirName = 'boxci'

  return isWindows
    ? path.join(homeDir!, 'AppData', boxCiDirName)
    : path.join(homeDir!, `.${boxCiDirName}`)
}

type AgentInfoFileUpdatePartial = {
  stopTime?: number
  stopReason?:
    | 'generic-error'
    | 'stopped-from-app'
    | 'invalid-creds'
    | 'invalid-config'
    | 'unsupported-version'
    | 'error-creating-logs-dir'
  stopDetail?: string
}

// --------- IMPORTANT ---------
//       NEVER CHANGE THIS!
// -----------------------------
const AGENT_INFO_FILE_NAME = 'info.json'

// this sets up the data directory structure if it doesn't already exist
export const setupBoxCiDataForAgent = ({
  agentConfig,
  spinner,
}: {
  agentConfig: AgentConfig
  spinner: Spinner
}): {
  dataDir: string
} => {
  const boxCiDir = getBoxCiDir({ spinner })

  try {
    createDirIfDoesNotExist(boxCiDir)
  } catch (err) {
    printErrorAndExit(`Could not create Box CI data directory @ ${Yellow(boxCiDir)}\n\nCause:\n\n${err}\n\n`, spinner) // prettier-ignore
  }

  // create a specific directory for this agent
  const agentDir = `${boxCiDir}/${agentConfig.agentName}`
  try {
    createDirIfDoesNotExist(agentDir)
  } catch (err) {
    printErrorAndExit(`Could not create Box CI agent directory @ ${Yellow(agentDir)}\n\nCause:\n\n${err}\n\n`, spinner) // prettier-ignore
  }

  // create a file for agent metadata like start time, project ID
  const infoFile = `${agentDir}/${AGENT_INFO_FILE_NAME}`
  try {
    const content = {
      startTime: getCurrentTimeStamp(),
      project: agentConfig.projectId,
    }

    fs.writeFileSync(infoFile, JSON.stringify(content, null, 2), 'utf8')
  } catch (err) {
    printErrorAndExit(`Could not create Box CI agent info file @ ${Yellow(infoFile)}\n\nCause:\n\n${err}\n\n`, spinner) // prettier-ignore
  }

  // create a directory for build logs
  const logsDir = `${agentDir}/${LOGS_DIR_NAME}`
  try {
    createDirIfDoesNotExist(logsDir)
  } catch (err) {
    writeToAgentInfoFileSync({
      agentName: agentConfig.agentName,
      updates: {
        stopTime: getCurrentTimeStamp(),
        stopReason: 'error-creating-logs-dir',
      },
    })

    printErrorAndExit(`Could not create Box CI logs directory @ ${Yellow(logsDir)}\n\nCause:\n\n${err}\n\n`, spinner) // prettier-ignore
  }

  return {
    dataDir: agentDir,
  }
}

export const writeToAgentInfoFileSync = ({
  agentName,
  updates,
}: {
  agentName: string
  updates: AgentInfoFileUpdatePartial
}): void => {
  const agentInfoFile = `${getBoxCiDir({ spinner: undefined, failSilently: true })}/${agentName}/${AGENT_INFO_FILE_NAME}` // prettier-ignore

  if (!agentInfoFile) {
    // if getBoxCiDir failed, fail sliently - it shouldn't stop things from running afterwards just because we can't write some metadata
  }

  let currentContent
  try {
    currentContent = JSON.parse(fs.readFileSync(agentInfoFile, 'utf8'))
  } catch (err) {
    // fail this silently - it shouldn't stop things from running afterwards just because we can't write some metadata
    return
  }

  try {
    const updatedContent = { ...currentContent, ...updates }
    fs.writeFileSync(
      agentInfoFile,
      JSON.stringify(updatedContent, null, 2),
      'utf8',
    )
  } catch (err) {
    // fail this silently - it shouldn't stop things from running afterwards just because we can't write some metadata
    return
  }
}

export const prepareForNewBuild = async ({
  agentConfig,
  dataDir,
  project,
  projectBuild,
  buildLogger,
}: {
  agentConfig: AgentConfig
  dataDir: string
  project: Project
  projectBuild: ProjectBuild
  buildLogger: BuildLogger
}): Promise<{ repoDir: string; consoleErrorMessage?: string }> => {
  const repoDir = `${dataDir}/${REPO_DIR_NAME}`

  // if repoDir does not exist, clone the repo into it
  if (!fs.existsSync(repoDir)) {
    const repoCloned = await git.cloneRepo({ localPath: repoDir, project })

    if (repoCloned) {
      buildLogger.writeEvent('INFO', `Cloned repository ${project.gitRepoSshUrl}`) // prettier-ignore
    } else {
      buildLogger.writeEvent('ERROR', `Could not clone repository ${project.gitRepoSshUrl}`) // prettier-ignore

      try {
        await api.setProjectBuildErrorCloningRepository({
          agentConfig,
          payload: {
            projectBuildId: projectBuild.id,
            gitRepoSshUrl: project.gitRepoSshUrl,
          },
          spinner: undefined,
          retries: DEFAULT_RETRIES,
        })
      } catch (err) {
        // log and ignore any errors here, build will just show as timed out instead
        buildLogger.writeError(`Could not set error cloning repository on server`, err) // prettier-ignore
      }

      return {
        repoDir,
        consoleErrorMessage: `Could not clone repository ${LightBlue(project.gitRepoSshUrl)}` // prettier-ignore
      }
    }
  }

  // make all git commands happen from repoDir
  const setCwd = git.setCwd({ dir: repoDir, buildLogger })

  if (!setCwd) {
    const errorMessage = `Could not set git working directory to repository directory ${repoDir}`
    buildLogger.writeEvent('ERROR', errorMessage)

    try {
      await api.setProjectBuildErrorPreparing({
        agentConfig,
        payload: {
          projectBuildId: projectBuild.id,
          errorMessage,
        },
        spinner: undefined,
        retries: DEFAULT_RETRIES,
      })
    } catch (err) {
      // log and ignore any errors here, build will just show as timed out instead
      buildLogger.writeError(`Could not set error cloning repository on server`, err) // prettier-ignore
    }

    return {
      repoDir,
      consoleErrorMessage: `Could not set git working directory to repository directory @ ${LightBlue(project.gitRepoSshUrl)}` // prettier-ignore
    }
  }

  // fetch the latest into the repo
  const fetchedRepo = await git.fetchRepoInCwd({ buildLogger })
  if (fetchedRepo) {
    buildLogger.writeEvent('INFO', `Fetched repository ${project.gitRepoSshUrl}`) // prettier-ignore
  } else {
    buildLogger.writeEvent('ERROR', `Could not fetch repository ${project.gitRepoSshUrl}`) // prettier-ignore

    try {
      await api.setProjectBuildErrorFetchingRepository({
        agentConfig,
        payload: {
          projectBuildId: projectBuild.id,
          gitRepoSshUrl: project.gitRepoSshUrl,
        },
        spinner: undefined,
        retries: DEFAULT_RETRIES,
      })
    } catch (err) {
      // log and ignore any errors here, build will just show as timed out instead
      buildLogger.writeError(`Could not set error fetching repository on server`, err) // prettier-ignore
    }

    return {
      repoDir,
      consoleErrorMessage: `Could not fetch repository ${LightBlue(project.gitRepoSshUrl)}` // prettier-ignore
    }
  }

  // checkout the commit specified in the build
  const checkoutOutCommit = await git.checkoutCommit({
    commit: projectBuild.gitCommit,
    buildLogger,
  })

  if (checkoutOutCommit) {
    buildLogger.writeEvent('INFO', `Checked out commit ${projectBuild.gitCommit} from repository @ ${project.gitRepoSshUrl}`) // prettier-ignore
  } else {
    buildLogger.writeEvent('ERROR', `Could not check out commit ${projectBuild.gitCommit} from repository @ ${project.gitRepoSshUrl}`) // prettier-ignore

    try {
      // if the checkout fails, we can assume the commit does not exist
      // (it might be on a branch which was deleted since the build was started
      // especially if the build was queued for a while)
      await api.setProjectBuildErrorGitCommitNotFound({
        agentConfig,
        payload: {
          projectBuildId: projectBuild.id,
          gitRepoSshUrl: project.gitRepoSshUrl,
        },
        spinner: undefined,
        retries: DEFAULT_RETRIES,
      })
    } catch (err) {
      buildLogger.writeError(`Could not set commit not found on server`, err)
    }

    return {
      repoDir,
      consoleErrorMessage: `Could not check out commit ${Yellow(projectBuild.gitCommit)} from repository @ ${LightBlue(project.gitRepoSshUrl)}` // prettier-ignore
    }
  }

  return {
    repoDir,
  }
}
