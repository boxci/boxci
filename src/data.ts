import fs from 'fs'
import path from 'path'
import api, { Project, ProjectBuild, DEFAULT_RETRIES } from './api'
import { LightBlue, Yellow } from './consoleFonts'
import git from './git'
import { printErrorAndExit, printHistoryErrorAndExit } from './logging'
import Spinner from './Spinner'
import { AgentConfig } from './config'
import BuildLogger from './BuildLogger'
import { getCurrentTimeStamp } from './util'
import rimraf from 'rimraf'

const UTF8 = 'utf8'

const writeJsonFile = (path: string, json: any) => {
  fs.writeFileSync(path, JSON.stringify(json, null, 2), UTF8)
}

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

// --------- IMPORTANT ---------
//       NEVER CHANGE THESE!
// -----------------------------
const BOXCI_INFO_FILE_NAME = 'info.json'
const AGENT_INFO_FILE_NAME = 'info.json'
export const BUILD_INFO_FILE_NAME = 'info.json'

export const boxCiDataDirExists = () => {
  const boxCiDir = getBoxCiDir({ spinner: undefined })

  try {
    return fs.existsSync(boxCiDir)
  } catch {
    // fail silently on any error when checking if the file exists
    // and just return false
    return false
  }
}

// this sets up the data directory structure if it doesn't already exist
export const setupBoxCiDataForAgent = ({
  agentConfig,
  spinner,
}: {
  agentConfig: AgentConfig
  spinner: Spinner
}): {
  agentDirName: string
} => {
  const boxCiDir = getBoxCiDir({ spinner })

  try {
    createDirIfDoesNotExist(boxCiDir)

    const boxCiInfoFileContent: BoxCIInfoFile = {
      createdAt: getCurrentTimeStamp(),
    }

    writeJsonFile(`${boxCiDir}/${BOXCI_INFO_FILE_NAME}`, boxCiInfoFileContent)
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
    const content: AgentInfoFile = {
      agentName: agentConfig.agentName,
      startTime: getCurrentTimeStamp(),
      project: agentConfig.projectId,
    }

    writeJsonFile(infoFile, content)
  } catch (err) {
    printErrorAndExit(`Could not create Box CI agent info file @ ${Yellow(infoFile)}\n\nCause:\n\n${err}\n\n`, spinner) // prettier-ignore
  }

  return {
    agentDirName: agentDir,
  }
}

export const setupBoxCiDataForBuild = ({
  projectBuild,
  agentConfig,
}: {
  projectBuild: ProjectBuild
  agentConfig: AgentConfig
}): string | undefined => {
  const boxCiDir = getBoxCiDir({ spinner: undefined, failSilently: true })

  if (!boxCiDir) {
    // just return undefined on error
    // let caller handle any errors setting up the build data
    return
  }

  const agentDir = `${boxCiDir}/${agentConfig.agentName}`
  const agentBuildDir = `${agentDir}/${projectBuild.id}`
  const buildInfoFileName = `${agentBuildDir}/${BUILD_INFO_FILE_NAME}`
  const buildInfoFileContent: BuildInfoFile = {
    id: projectBuild.id,
    startTime: getCurrentTimeStamp(),
  }

  try {
    fs.mkdirSync(agentBuildDir)
    writeJsonFile(buildInfoFileName, buildInfoFileContent)

    return agentBuildDir
  } catch (err) {
    // just return undefined on error
    // let caller handle any errors setting up the build data
    return
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
    currentContent = JSON.parse(fs.readFileSync(agentInfoFile, UTF8))
  } catch (err) {
    // fail this silently - it shouldn't stop things from running afterwards just because we can't write some metadata
    return
  }

  try {
    const updatedContent = { ...currentContent, ...updates }

    writeJsonFile(agentInfoFile, updatedContent)
  } catch (err) {
    // fail this silently - it shouldn't stop things from running afterwards just because we can't write some metadata
    return
  }
}

export type BuildHistory = {
  info: BuildInfoFile
}

type BuildInfoFile = {
  id: string
  startTime: number
}

export type AgentHistory = {
  info: AgentInfoFile
  numberOfBuilds: number
  builds?: Array<BuildHistory>
}

type AgentInfoFile = {
  agentName: string
  project: string
  startTime: number
} & AgentInfoFileUpdatePartial

type AgentInfoFileUpdatePartial = {
  stopTime?: number
  stopReason?:
    | 'error-getting-project'
    | 'stopped-from-app'
    | 'invalid-creds'
    | 'invalid-config'
    | 'unsupported-version'
    | 'error-creating-logs-dir'
  stopDetail?: string
}

type BoxCIInfoFileUpdatePartial = {
  cleanedAt?: number
}

type BoxCIInfoFile = {
  createdAt: number
} & BoxCIInfoFileUpdatePartial

export type History = {
  info: BoxCIInfoFile
  agents: Array<AgentHistory>
}

export const AGENT_DIRNAME_PREFIX = 'agent-'

// keep all filename generation in one place
export const filenameUtils = {
  logsFile: ({ buildId }: { buildId: string }) => `logs-${buildId}.txt`,
  eventsFile: ({ buildId }: { buildId: string }) => `events-${buildId}.txt`,
}

const validateAndSortByAgentStartTime = (history: History): History => {
  // TODO perhaps warn about any invalid agents history files
  // but just filter them out and continue with the valid ones
  const agents = history.agents.filter(
    (agent) =>
      agent.info.agentName !== undefined &&
      agent.info.project !== undefined &&
      agent.info.startTime !== undefined,
  )

  // sort the agents by start time (stop time may not be available)
  agents.sort(
    (a: AgentHistory, b: AgentHistory) => b.info.startTime - a.info.startTime,
  )

  return { ...history, agents }
}

const validateAndSortByBuildStartTime = (
  agentHistory: AgentHistory,
): AgentHistory => {
  // if no builds, nothing to do, just return
  if (agentHistory.builds === undefined) {
    return agentHistory
  }

  // TODO perhaps warn about any invalid build history files
  // but just filter them out and continue with the valid ones
  const builds = agentHistory.builds.filter(
    (build) =>
      build.info.id !== undefined && build.info.startTime !== undefined,
  )

  // sort the agents by start time (stop time may not be available)
  builds.sort(
    (a: BuildHistory, b: BuildHistory) => b.info.startTime - a.info.startTime,
  )

  return { ...agentHistory, builds }
}

const getAgentHistoryForVerifiedAgentDirPath = ({
  agentDirPath,
  includeBuilds,
}: {
  agentDirPath: string
  includeBuilds: boolean
}): AgentHistory => {
  const agentInfoFileName = `${agentDirPath}/${AGENT_INFO_FILE_NAME}`

  let info: AgentInfoFile
  try {
    info = JSON.parse(fs.readFileSync(agentInfoFileName, UTF8))
  } catch (err) {
    printHistoryErrorAndExit(err)

    return undefined as never
  }

  let numberOfBuilds
  let builds: Array<BuildHistory>
  try {
    const agentBuildDirsMeta = getAgentBuildDirsMeta(agentDirPath)
    numberOfBuilds = agentBuildDirsMeta.length

    if (includeBuilds) {
      builds = agentBuildDirsMeta.map(({ path }) => ({
        info: JSON.parse(
          fs.readFileSync(`${path}/${BUILD_INFO_FILE_NAME}`, UTF8),
        ),
      }))
    }
  } catch (err) {
    printHistoryErrorAndExit(err)

    return undefined as never
  }

  return {
    info,
    numberOfBuilds,
    ...(includeBuilds && { builds: builds! }),
  }
}

type DirMeta = { path: string; name: string }

export const getAgentDirsMeta = (boxCiDirName: string): Array<DirMeta> => {
  return fs
    .readdirSync(boxCiDirName)
    .filter((name) => name.startsWith(AGENT_DIRNAME_PREFIX))
    .map((name) => ({
      name,
      path: path.join(boxCiDirName, name),
    }))
    .filter(({ path }) => fs.statSync(path).isDirectory())
}

export const getAgentBuildDirsMeta = (agentDirPath: string): Array<DirMeta> =>
  fs
    .readdirSync(agentDirPath)
    .filter((name) => name.startsWith('B'))
    .map((name) => ({ name, path: path.join(agentDirPath, name) }))
    .filter(({ path }) => fs.statSync(path).isDirectory())

export const readHistory = (): History => {
  const boxCiDirName = getBoxCiDir({ spinner: undefined })

  try {
    const history: History = {
      info: JSON.parse(
        fs.readFileSync(`${boxCiDirName}/${BOXCI_INFO_FILE_NAME}`, UTF8),
      ),
      agents: getAgentDirsMeta(boxCiDirName).map(({ path }) =>
        getAgentHistoryForVerifiedAgentDirPath({
          agentDirPath: path,
          includeBuilds: false,
        }),
      ),
    }

    return validateAndSortByAgentStartTime(history)
  } catch (err) {
    printHistoryErrorAndExit(err)

    // just for TS
    return undefined as never
  }
}

export const readAgentHistory = ({
  agentName,
}: {
  agentName: string
}): AgentHistory | undefined => {
  const boxCiDir = getBoxCiDir({ spinner: undefined })
  const agentDirPath = `${boxCiDir}/${agentName}`

  // if the provided agent name doesn't exist, return nothing and error in caller
  if (!fs.existsSync(agentDirPath)) {
    return
  }

  // otherwise try to read the agent history
  // if the history is corrupted or there's some file access issue, fail here
  const agentHistory = getAgentHistoryForVerifiedAgentDirPath({
    agentDirPath,
    includeBuilds: true,
  })

  return validateAndSortByBuildStartTime(agentHistory)
}

// the simplest thing to do here is just to save the contents of the info file
// beforehand, delete the entire directory, then recreate it
//
// note that this will delete history of any running builds part way through
export const cleanHistory = (): History | undefined => {
  const boxCiDir = getBoxCiDir({ spinner: undefined, failSilently: true })

  // fail in caller on error
  if (boxCiDir === undefined) {
    return
  }

  const historyBeforeDeleting = readHistory()

  try {
    rimraf.sync(boxCiDir)
  } catch (err) {
    printErrorAndExit(`Could not delete Box CI data directory @ ${Yellow(boxCiDir)}\n\nCause:\n\n${err}\n\n`) // prettier-ignore
  }

  try {
    fs.mkdirSync(boxCiDir)

    const boxCiInfoFileContent: BoxCIInfoFile = {
      ...historyBeforeDeleting.info,
      cleanedAt: getCurrentTimeStamp(),
    }

    writeJsonFile(`${boxCiDir}/${BOXCI_INFO_FILE_NAME}`, boxCiInfoFileContent)
  } catch (err) {
    printErrorAndExit(`Could not create Box CI data directory @ ${Yellow(boxCiDir)}\n\nCause:\n\n${err}\n\n`) // prettier-ignore
  }

  return historyBeforeDeleting
}

const getAgentRepoDirName = ({ agentConfig }: { agentConfig: AgentConfig }) => {
  const boxCiDirName = getBoxCiDir({ spinner: undefined })
  const agentDirName = `${boxCiDirName}/${agentConfig.agentName}`
  const repoDir = `${agentDirName}/${REPO_DIR_NAME}`

  return repoDir
}

export const prepareForNewBuild = async ({
  agentConfig,
  project,
  projectBuild,
  buildLogger,
}: {
  agentConfig: AgentConfig
  project: Project
  projectBuild: ProjectBuild
  buildLogger: BuildLogger
}): Promise<{ repoDir: string; consoleErrorMessage?: string }> => {
  const repoDir = getAgentRepoDirName({ agentConfig })

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
