import fs from 'fs'
import path from 'path'
import api, { Project, ProjectBuild, DEFAULT_RETRIES } from './api'
import { LightBlue, Yellow, Bright } from './consoleFonts'
import git from './git'
import { printErrorAndExit, printHistoryErrorAndExit } from './logging'
import Spinner from './Spinner'
import { AgentConfig } from './config'
import BuildLogger from './BuildLogger'
import { getCurrentTimeStamp } from './util'
import rimraf from 'rimraf'

const UTF8 = 'utf8'

const writeImmutableEventFile = (dir: string, json: any) => {
  try {
    // be robust against the dir not existing - just create it if it doesn't exist
    createDirIfDoesNotExist(dir)

    fs.writeFileSync(
      `${dir}/${getCurrentTimeStamp()}.json`,
      JSON.stringify(json, null, 2),
      UTF8,
    )
  } catch {
    // this function is completely fire and forget, never throw if it fails
  }
}

export const REPO_DIR_NAME = 'repo'

const createDirIfDoesNotExist = (path: string) => {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path)
  }
}

let _cachedBoxCiDir: string = ''

const paths_buildsDir = (boxCiDir: string) => boxCiDir + '/b' // prettier-ignore
const paths_buildDir = (boxCiDir: string, buildId: string) => paths_buildsDir(boxCiDir) + `/${buildId}` // prettier-ignore
const paths_buildLogsDir = (boxCiDir: string, buildId: string) => paths_buildDir(boxCiDir, buildId) + `/logs` // prettier-ignore
const paths_buildMetaDir = (boxCiDir: string, buildId: string) => paths_buildDir(boxCiDir, buildId) + `/meta` // prettier-ignore
const paths_metaDir = (boxCiDir: string) => boxCiDir + '/meta' // prettier-ignore
const paths_boxCiMetaDir = (boxCiDir: string) => paths_metaDir(boxCiDir) + '/boxci' // prettier-ignore
const paths_agentsMetaDir = (boxCiDir: string) => paths_metaDir(boxCiDir) + '/agent' // prettier-ignore
const paths_agentMetaDir = (boxCiDir: string, agentName: string) => paths_agentsMetaDir(boxCiDir) + `/${agentName}` // prettier-ignore

// keep all path generation in one place
const paths = {
  buildsDir: paths_buildsDir,
  buildDir: paths_buildDir,
  buildLogsDir: paths_buildLogsDir,
  buildMetaDir: paths_buildMetaDir,
  metaDir: paths_metaDir,
  boxCiMetaDir: paths_boxCiMetaDir,
  agentsMetaDir: paths_agentsMetaDir,
  agentMetaDir: paths_agentMetaDir,
}

// keep all filename generation in one place
export const filenameUtils = {
  logsFile: ({ buildId }: { buildId: string }) => `logs-${buildId}.txt`,
  eventsFile: ({ buildId }: { buildId: string }) => `events-${buildId}.txt`,
}

export const getBoxCiDir = (spinner?: Spinner) => {
  if (!_cachedBoxCiDir) {
    const platform = process.platform
    const isWindows = platform === 'win32'
    const homeDirEnvVar = isWindows ? 'USERPROFILE' : 'HOME'
    const homeDir = process.env[homeDirEnvVar]

    // if could not find the home dir, exit -- there's no way to continue with any command if this is the case
    if (!homeDir) {
      // prettier-ignore
      printErrorAndExit(
        `Could not identify the home directory on this operating system (${platform}) ` +
        `- tried to locate it with the environment variable [ ${homeDirEnvVar} ] but no value is set`,
        spinner
      )

      return undefined as never
    }

    const boxCiDirName = 'boxci'

    // this will never change while running on the same system, so just cache it
    _cachedBoxCiDir = isWindows
      ? path.join(homeDir, 'AppData', boxCiDirName)
      : path.join(homeDir, `.${boxCiDirName}`)
  }

  const boxCiDir = _cachedBoxCiDir + ''

  // As part of calling this, also create the entire structure if it doesn't exist yet
  //
  // This provides a bit of robustness against these data directories being manually deleted etc
  // as we'll just recreate them before needing to access them to add new files etc
  //
  // This should be pretty robust becuase of the immutable write-only strategy. We never assume files are present to
  // update, only need to ensure the dir structures are in place to create new files.
  //
  // if any of this fails, again, exit -- no way to continue with any command if we don't have this structure in place
  //
  // THE DIR STRUCTURE IS AS FOLLOWS:
  //
  // .boxci > /b
  //          /meta > /boxci
  //                  /agent
  try {
    createDirIfDoesNotExist(boxCiDir) //                      .boxci
    createDirIfDoesNotExist(paths.buildsDir(boxCiDir)) //     .boxci/b/{buildId}               Build metadata (dir per build) & logs in /logs sub dir
    createDirIfDoesNotExist(paths.metaDir(boxCiDir)) //       .boxci/meta
    createDirIfDoesNotExist(paths.boxCiMetaDir(boxCiDir)) //  .boxci/meta/boxci                General metadata (starts out empty)
    createDirIfDoesNotExist(paths.agentsMetaDir(boxCiDir)) // .boxci/meta/agent/{agentName}    agent metadata (dir per agent) & git repo in /repo sub dir

    return boxCiDir
  } catch (err) {
    printErrorAndExit(`Could not create Box CI data directories @ ${Yellow(boxCiDir)}\n\nCause:\n\n${err}\n\n`, spinner) // prettier-ignore

    return undefined as never
  }
}

// --------- IMPORTANT ---------
//       NEVER CHANGE THESE!
// -----------------------------
const BOXCI_INFO_FILE_NAME = 'info.json'
const AGENT_INFO_FILE_NAME = 'info.json'
export const BUILD_INFO_FILE_NAME = 'info.json'

export const boxCiDataDirExists = () => {
  const boxCiDir = getBoxCiDir()

  try {
    return fs.existsSync(boxCiDir)
  } catch {
    // fail silently on any error when checking if the file exists
    // and just return false
    return false
  }
}

// creates the metadata directory for the agent when it is started
export const createAgentMeta = ({
  agentConfig,
  spinner,
}: {
  agentConfig: AgentConfig
  spinner: Spinner
}): string => {
  const boxCiDir = getBoxCiDir(spinner)
  const agentMetaDir = paths.agentMetaDir(boxCiDir, agentConfig.agentName)

  try {
    fs.mkdirSync(agentMetaDir)

    // NOTE: no need to create the /repo dir here manually - it is done by the git clone command later

    // write first metadata event for the agent, with project ID and start time
    writeImmutableEventFile(agentMetaDir, {
      p: agentConfig.projectId,
      t: getCurrentTimeStamp(),
    })

    return agentMetaDir
  } catch (err) {
    // if there are errors here, it indicates a fundamental issue that
    // will probably mean we can't continue running the agent without issues
    // on this machine, so do exit
    printErrorAndExit(`Could not create metadata files for agent ${Bright(agentConfig.agentName)}\n\nCause:\n\n${err}\n\n`, spinner) // prettier-ignore

    return undefined as never
  }
}

// creates the directory for a build, containing both metadata and logs, when it is started
export const createBuildDir = ({
  projectBuild,
  agentConfig,
  spinner,
}: {
  projectBuild: ProjectBuild
  agentConfig: AgentConfig
  spinner: Spinner
}): string => {
  const boxCiDir = getBoxCiDir()
  const buildDir = paths.buildDir(boxCiDir, projectBuild.id)
  const buildLogsDir = paths.buildLogsDir(boxCiDir, projectBuild.id)
  const buildMetaDir = paths.buildMetaDir(boxCiDir, projectBuild.id)

  try {
    fs.mkdirSync(buildDir)
    fs.mkdirSync(buildLogsDir)
    fs.mkdirSync(buildMetaDir)

    // write first metadata event for the build, with project ID, agent name and start time
    writeImmutableEventFile(buildMetaDir, {
      a: agentConfig.agentName,
      p: agentConfig.projectId,
      t: getCurrentTimeStamp(),
    })

    return buildLogsDir
  } catch (err) {
    // if there are errors here, it indicates a fundamental issue that
    // will probably mean we can't continue running the agent without issues
    // on this machine, so do exit
    printErrorAndExit(`Could not create metadata files for build ${Bright(agentConfig.agentName)}\n\nCause:\n\n${err}\n\n`, spinner) // prettier-ignore

    return undefined as never
  }
}

// writes a metadata event for an agent, private function called by other for strong types over meta for different usecases
const writeAgentMeta = ({
  agentName,
  meta,
}: {
  agentName: string
  meta: any
}) => {
  const agentMetaDir = paths.agentMetaDir(getBoxCiDir(), agentName)

  writeImmutableEventFile(agentMetaDir, meta)
}

export const writeAgentStoppedMeta = ({
  agentName,
  stoppedAt,
  stopReason,
}: {
  agentName: string
  stopReason:
    | 'error-getting-project'
    | 'stopped-from-app'
    | 'stopped-from-cli'
    | 'invalid-creds'
    | 'invalid-config'
    | 'unsupported-version'
    | 'error-creating-logs-dir'
  stoppedAt?: number
}) => {
  writeAgentMeta({
    agentName,
    meta: {
      stopReason,
      stoppedAt: stoppedAt ?? getCurrentTimeStamp(),
    },
  })
}

export type BuildHistory = {
  info: BuildInfoFile
}

type BuildInfoFile = {
  id: string
  startTime: number
}

export type AgentHistory = {
  info: AgentMeta
  numberOfBuilds: number
  builds?: Array<BuildHistory>
}

type AgentMetaEvent = {
  agentName?: string
  project?: string
  startTime?: number
}

type BoxCIInfoFileUpdatePartial = {
  cleanedAt?: number
}

type StopAgentData = {
  stopCommandAt: number
  stoppedAt?: number
}

type BoxCIInfoFile = {
  createdAt: number
  stopAgents: { [agentName: string]: StopAgentData }
} & BoxCIInfoFileUpdatePartial

export type History = {
  info: BoxCIInfoFile
  agents: Array<AgentHistory>
}

export const AGENT_DIRNAME_PREFIX = 'agent-'

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

  let info: AgentMeta
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
      builds = agentBuildDirsMeta.map(({ path }) =>
        getBuildHistoryForVerifiedBuildDirPath({ buildDirPath: path }),
      )
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

const getBuildHistoryForVerifiedBuildDirPath = ({
  buildDirPath,
}: {
  buildDirPath: string
}): BuildHistory => {
  try {
    return {
      info: JSON.parse(
        fs.readFileSync(`${buildDirPath}/${BUILD_INFO_FILE_NAME}`, UTF8),
      ),
    }
  } catch (err) {
    printHistoryErrorAndExit(err)

    return undefined as never
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

export const readBuildHistory = ({
  agentName,
  buildId,
}: {
  agentName: string
  buildId: string
}): BuildHistory | undefined => {
  const boxCiDir = getBoxCiDir({ spinner: undefined })
  const agentDirPath = `${boxCiDir}/${agentName}`

  // if the provided agent name doesn't exist, return nothing and error in caller
  if (!fs.existsSync(agentDirPath)) {
    return
  }

  // if the provided build doesn't exist, return nothing and error in caller
  const buildDirPath = `${agentDirPath}/${buildId}`
  if (!fs.existsSync(buildDirPath)) {
    return
  }

  // otherwise try to read the build history
  // if the history is corrupted or there's some file access issue, fail here
  const buildHistory = getBuildHistoryForVerifiedBuildDirPath({
    buildDirPath,
  })

  // validate before returning
  if (
    buildHistory.info.id !== undefined &&
    buildHistory.info.startTime !== undefined
  ) {
    return buildHistory
  }
}

const createNewBoxCiInfoFile = (): BoxCIInfoFile => ({
  createdAt: getCurrentTimeStamp(),
  stopAgents: {},
})

// the simplest thing to do here is just to save the contents of the info file
// beforehand, delete the entire directory, then recreate it
//
// note that this will delete history of any running builds part way through
export const cleanHistory = ({
  hardDelete,
}: {
  hardDelete: boolean
}): History | undefined => {
  const boxCiDir = getBoxCiDir({ spinner: undefined, failSilently: true })

  // fail in caller on error
  if (boxCiDir === undefined) {
    return
  }

  const boxCiInfoFileName = `${boxCiDir}/${BOXCI_INFO_FILE_NAME}`
  const historyBeforeDeleting = readHistory()

  try {
    rimraf.sync(boxCiDir)
  } catch (err) {
    printErrorAndExit(`Could not delete Box CI data directory @ ${Yellow(boxCiDir)}\n\nCause:\n\n${err}\n\n`) // prettier-ignore

    return undefined as never
  }

  try {
    fs.mkdirSync(boxCiDir)
  } catch (err) {
    printErrorAndExit(`Could not create Box CI data directory @ ${Yellow(boxCiDir)}\n\nCause:\n\n${err}\n\n`) // prettier-ignore

    return undefined as never
  }

  // if this is a hard delete, don't recreate the old history, just start completely from scratch
  if (hardDelete) {
    const newInfoFile = createNewBoxCiInfoFile()
    try {
      writeJsonFile(boxCiInfoFileName, newInfoFile)

      return {
        info: newInfoFile,
        agents: [],
      }
    } catch (err) {
      printErrorAndExit(`Could not create Box CI data file @ ${Yellow(boxCiInfoFileName)}\n\nCause:\n\n${err}\n\n`) // prettier-ignore

      return undefined as never
    }
  }

  try {
    // For the stopAgents history, never delete entries that have not yet been stopped,
    // because this would stop the stop command from working if history is deleted after it is run and
    // before the agent is stopped, however do delete entries that have been stopped as they are
    // now no longer needed for this purpose
    const stopAgentsWithOnlyNotStoppedEntries: {
      [agentName: string]: StopAgentData
    } = {}

    for (let agentName in historyBeforeDeleting.info.stopAgents) {
      if (
        Object.prototype.hasOwnProperty.call(
          historyBeforeDeleting.info.stopAgents,
          agentName,
        )
      ) {
        const candidate = historyBeforeDeleting.info.stopAgents[agentName]

        if (candidate.stoppedAt === undefined) {
          stopAgentsWithOnlyNotStoppedEntries[agentName] = candidate
        }
      }
    }

    const updatedInfoFileContent: BoxCIInfoFile = {
      ...historyBeforeDeleting.info,
      stopAgents: stopAgentsWithOnlyNotStoppedEntries,
      cleanedAt: getCurrentTimeStamp(),
    }

    writeJsonFile(boxCiInfoFileName, updatedInfoFileContent)

    return historyBeforeDeleting
  } catch (err) {
    printErrorAndExit(`Could not create Box CI data file @ ${Yellow(boxCiInfoFileName)}\n\nCause:\n\n${err}\n\n`) // prettier-ignore

    return undefined as never
  }
}

export const cleanAgentHistory = ({
  agentName,
}: {
  agentName: string
}): AgentHistory | undefined => {
  const boxCiDir = getBoxCiDir({ spinner: undefined, failSilently: true })

  // fail in caller on error
  if (boxCiDir === undefined) {
    return
  }

  // fail in caller on error
  const agentDir = `${boxCiDir}/${agentName}`
  if (!fs.existsSync(agentDir)) {
    return
  }

  const historyBeforeDeleting = readAgentHistory({ agentName })

  // just delete the dir, no need to recreate in the case of an agent history
  try {
    rimraf.sync(agentDir)
  } catch (err) {
    printErrorAndExit(`Could not delete agent data directory @ ${Yellow(agentDir)}\n\nCause:\n\n${err}\n\n`) // prettier-ignore
  }

  return historyBeforeDeleting
}

export const cleanBuildHistory = ({
  agentName,
  buildId,
}: {
  agentName: string
  buildId: string
}): BuildHistory | undefined => {
  const boxCiDir = getBoxCiDir({ spinner: undefined, failSilently: true })

  // fail in caller on error
  if (boxCiDir === undefined) {
    return
  }

  // fail in caller on error
  const agentDir = `${boxCiDir}/${agentName}`
  if (!fs.existsSync(agentDir)) {
    return
  }

  // fail in caller on error
  const buildDir = `${agentDir}/${buildId}`
  if (!fs.existsSync(buildDir)) {
    return
  }

  const historyBeforeDeleting = readBuildHistory({ agentName, buildId })

  // just delete the dir, no need to recreate in the case of a build history
  try {
    rimraf.sync(buildDir)
  } catch (err) {
    printErrorAndExit(`Could not delete build data directory @ ${Yellow(buildDir)}\n\nCause:\n\n${err}\n\n`) // prettier-ignore
  }

  return historyBeforeDeleting
}

const getAgentRepoDirName = ({ agentConfig }: { agentConfig: AgentConfig }) => {
  const boxCiDirName = getBoxCiDir({ spinner: undefined })
  const agentDirName = `${boxCiDirName}/${agentConfig.agentName}`
  const repoDir = `${agentDirName}/${REPO_DIR_NAME}`

  return repoDir
}

// TODO reimplement
export const prepareForNewBuild = async ({
  agentConfig,
  project,
  projectBuild,
  buildLogger,
  agentMetaDir,
}: {
  agentConfig: AgentConfig
  project: Project
  projectBuild: ProjectBuild
  buildLogger: BuildLogger
  agentMetaDir: string
}): Promise<{ repoDir: string; consoleErrorMessage?: string }> => {
  const repoDir = `${agentMetaDir}/repo`

  // if repoDir does not exist yet, it means we need to clone the repo
  if (!fs.existsSync(repoDir)) {
    const repoCloned = await git.cloneRepo({
      localPath: repoDir,
      project,
    })

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
  const setCwd = git.setCwd({
    dir: repoDir,
    buildLogger,
  })

  // if there was a problem doing this, exit with error
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

  // at this point we know the repo is present, so fetch the latest
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

  // now checkout the commit specified in the build
  const checkoutOutCommit = await git.checkoutCommit({
    commit: projectBuild.gitCommit,
    buildLogger,
  })

  if (checkoutOutCommit) {
    buildLogger.writeEvent('INFO', `Checked out commit ${projectBuild.gitCommit} from repository @ ${project.gitRepoSshUrl}`) // prettier-ignore
  }
  // if there is an error, exit
  else {
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

  // on success, return the path of the repo
  return {
    repoDir,
  }
}

export const stopAgent = ({ agentName }: { agentName: string }) => {
  const boxCiInfoFile = `${getBoxCiDir({ spinner: undefined })}/${BOXCI_INFO_FILE_NAME}` // prettier-ignore

  let currentContent: BoxCIInfoFile
  try {
    currentContent = JSON.parse(fs.readFileSync(boxCiInfoFile, UTF8))
  } catch (err) {
    printErrorAndExit(`Could not read Box CI metadata file ${boxCiInfoFile}\n\nCause:\n\n${err}\n\n`) // prettier-ignore

    return undefined as never
  }

  // if the stop command already called for this agent, do nothing
  if (currentContent.stopAgents[agentName]?.stopCommandAt !== undefined) {
    return
  }

  try {
    // add new stopAgents entry for this agent
    const updatedContent: BoxCIInfoFile = {
      ...currentContent,
      stopAgents: {
        ...currentContent.stopAgents,
        [agentName]: {
          stopCommandAt: getCurrentTimeStamp(),
        },
      },
    }

    writeJsonFile(boxCiInfoFile, updatedContent)
  } catch (err) {
    printErrorAndExit(`Could not write Box CI metadata file ${boxCiInfoFile}\n\nCause:\n\n${err}\n\n`) // prettier-ignore
  }
}

export const getShouldStopAgent = ({
  agentName,
}: {
  agentName: string
}): { stoppedAt: number } | undefined => {
  const boxCiDir = getBoxCiDir({ spinner: undefined, failSilently: true })

  // do nothing on error
  if (boxCiDir === undefined) {
    return
  }

  try {
    const boxCiInfoFilename = `${boxCiDir}/${BOXCI_INFO_FILE_NAME}`
    const boxCiInfo: BoxCIInfoFile = JSON.parse(
      fs.readFileSync(boxCiInfoFilename, UTF8),
    )

    const candidate = boxCiInfo.stopAgents[agentName]

    if (
      candidate !== undefined &&
      candidate.stopCommandAt !== undefined &&
      candidate.stoppedAt === undefined
    ) {
      // set agent to stopped
      const stoppedAt = getCurrentTimeStamp()
      const updatedContent: BoxCIInfoFile = {
        ...boxCiInfo,
        stopAgents: {
          ...boxCiInfo.stopAgents,
          [agentName]: {
            ...candidate,
            stoppedAt,
          },
        },
      }

      writeJsonFile(boxCiInfoFilename, updatedContent)

      return {
        stoppedAt, // return as stopTime in the agent's history should be set to the same time
      }
    }
  } catch (err) {
    // do nothing on error
    return
  }
}
