import fs from 'fs'
import path from 'path'
import rimraf from 'rimraf'
import { ProjectBuild } from './api'
import { AgentConfig } from './config'
import { Bright, Yellow } from './consoleFonts'
import { printErrorAndExit } from './logging'
import Spinner from './Spinner'
import { getCurrentTimeStamp } from './util'

type BoxCIMeta = {}

type AgentStopReason =
  | 'error-getting-project'
  | 'stopped-from-app'
  | 'stopped-from-cli'
  | 'invalid-creds'
  | 'invalid-config'
  | 'unsupported-version'
  | 'error-creating-logs-dir'

export type AgentMeta = {
  t: number // start time
  stoppedAt?: number
  stopReason?: AgentStopReason
}

export type BuildMeta = {
  id: string // build ID
  p: string //  project ID
  a: string //  agent name
  t: number //  start time
  l?: number // logs cleared at
}

export type BoxCIHistory = {
  boxCi: BoxCIMeta
  agents: AgentMeta[]
  builds: BuildMeta[]
}

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
const paths_stopAgentMetaDir= (boxCiDir: string) => boxCiDir + '/sa' // prettier-ignore
const paths_stopAgentMetaFile= (boxCiDir: string, agentName: string) => boxCiDir + `/sa/${agentName}` // prettier-ignore

// keep all path generation in one place
export const paths = {
  buildsDir: paths_buildsDir,
  buildDir: paths_buildDir,
  buildLogsDir: paths_buildLogsDir,
  buildMetaDir: paths_buildMetaDir,
  metaDir: paths_metaDir,
  boxCiMetaDir: paths_boxCiMetaDir,
  agentsMetaDir: paths_agentsMetaDir,
  agentMetaDir: paths_agentMetaDir,
  stopAgentMetaDir: paths_stopAgentMetaDir,
  stopAgentMetaFile: paths_stopAgentMetaFile,
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
  try {
    createDirIfDoesNotExist(boxCiDir) //                          .boxci
    createDirIfDoesNotExist(paths.buildsDir(boxCiDir)) //         .boxci/b/{buildId}               Build metadata (dir per build) & logs in /logs sub dir
    createDirIfDoesNotExist(paths.metaDir(boxCiDir)) //           .boxci/meta
    createDirIfDoesNotExist(paths.boxCiMetaDir(boxCiDir)) //      .boxci/meta/boxci                General metadata (starts out empty)
    createDirIfDoesNotExist(paths.agentsMetaDir(boxCiDir)) //     .boxci/meta/agent/{agentName}    Agent metadata (dir per agent) & git repo in /repo sub dir
    createDirIfDoesNotExist(paths.stopAgentMetaDir(boxCiDir)) //  .boxci/meta/sa                   Stop agent metadata (file per agent)

    return boxCiDir
  } catch (err) {
    printErrorAndExit(`Could not create Box CI data directories @ ${Yellow(boxCiDir)}\n\nCause:\n\n${err}\n\n`, spinner) // prettier-ignore

    return undefined as never
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
      id: projectBuild.id,
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

// writes a metadata event for an agent, private function
// called by others for strong types over meta for different usecases
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

// writes a metadata event for a build, private function
// called by others for strong types over meta for different usecases
const writeBuildMeta = ({ buildId, meta }: { buildId: string; meta: any }) => {
  const buildMetaDir = paths.buildMetaDir(getBoxCiDir(), buildId)

  writeImmutableEventFile(buildMetaDir, meta)
}

const writeBuildLogsClearedMeta = ({ buildId }: { buildId: string }) => {
  writeBuildMeta({
    buildId,
    meta: {
      l: getCurrentTimeStamp(),
    },
  })
}

export const writeAgentStoppedMeta = ({
  agentName,
  stoppedAt,
  stopReason,
}: {
  agentName: string
  stopReason: AgentStopReason
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

const getDirsIn = (dir: string): Array<string> => {
  try {
    return fs
      .readdirSync(dir)
      .map((name) => `${dir}/${name}`)
      .filter((path) => fs.statSync(path).isDirectory())
  } catch {
    // on error just return empty array, equivalent to saying the directories contains no sub directories
    return []
  }
}

const getFilePathsIn = (dir: string): Array<string> => {
  try {
    return fs
      .readdirSync(dir)
      .map((name) => `${dir}/${name}`)
      .filter((path) => !fs.statSync(path).isDirectory())
  } catch {
    // on error just return empty array, equivalent to saying the directories contains no files
    return []
  }
}

const sortEventsByTimeLatestLast = (a: string, b: string) => {
  if (a < b) {
    return -1
  }

  if (a > b) {
    return 1
  }

  return 0
}

type Meta<T> = {
  meta: T
  events: Partial<T>[]
}

// reads and constructs metadata from series of events recorded
// in meta files with {timestamp}.json format
//
// returns the ordered events (latest last) and the combined meta object by collecting the events
const buildMeta = <T>(eventFiles: Array<string>): Meta<T> => {
  eventFiles.sort(sortEventsByTimeLatestLast)

  let meta: T = {} as T
  const events: object[] = []

  for (let metadataEventFile of eventFiles) {
    try {
      const event = JSON.parse(fs.readFileSync(metadataEventFile, UTF8))

      events.push(event)
      meta = { ...meta, ...event }
    } catch (err) {
      console.log(err)
      // on any type of error, just skip over this event
      // if all fail, metadata will just come back empty
    }
  }

  return { meta, events }
}

export const readMetaFromDir = <T>(dir: string): Meta<T> =>
  buildMeta<T>(getFilePathsIn(dir))

const sortByStartTimeLatestFirst = (builds: BuildMeta[]) => {
  builds.sort((a, b) => b.t - a.t)

  return builds
}

export const readHistory = (): BoxCIHistory => {
  const boxCiDir = getBoxCiDir()

  // prettier-ignore
  return {
    boxCi: buildMeta<BoxCIMeta>(getFilePathsIn(paths.boxCiMetaDir(boxCiDir))).meta,
    agents: getDirsIn(paths.agentsMetaDir(boxCiDir))
      .map((agentMetaDir) => buildMeta<AgentMeta>(getFilePathsIn(agentMetaDir)).meta),
    builds: sortByStartTimeLatestFirst(getDirsIn(paths.buildsDir(boxCiDir))
      .map((buildDir) => buildMeta<BuildMeta>(getFilePathsIn(`${buildDir}/meta`)).meta))
  }
}

export const deleteLogs = ({
  buildId,
}: {
  buildId: string
}): 'not-found' | 'error-deleting' | undefined => {
  const boxCiDir = getBoxCiDir()

  const buildLogsDir = paths.buildLogsDir(boxCiDir, buildId)

  if (!fs.existsSync(buildLogsDir)) {
    return 'not-found'
  }

  try {
    rimraf.sync(buildLogsDir)
  } catch {
    return 'error-deleting'
  }
}

// the stop command works by writing a special stop metadata file
// which can be quickly checked for (rather than, for example, reading and contructing agent metadata
// it's only necessary to check for the existance of this file)
export const stopAgent = ({
  agentName,
}: {
  agentName: string
}): {
  code: 'not-found' | 'already-stopped' | 'error' | 'success'
  detail?: any
} => {
  const boxCiDir = getBoxCiDir()

  try {
    // first, validate the agent name exists and is not already stopped
    const agentMetaDir = paths.agentMetaDir(boxCiDir, agentName)

    if (!fs.existsSync(agentMetaDir)) {
      return { code: 'not-found' }
    } else {
      const agentMeta = buildMeta<AgentMeta>(getFilePathsIn(agentMetaDir)).meta

      if (agentMeta.stoppedAt !== undefined) {
        return {
          code: 'already-stopped',
          detail: {
            stoppedAt: agentMeta.stoppedAt,
            stoppedReason: agentMeta.stopReason,
          },
        }
      }
    }

    // create an empty marker file with the same name as the agent
    // only if it doesn't already exist
    const stopAgentFilePath = paths.stopAgentMetaFile(boxCiDir, agentName)
    if (!fs.existsSync(stopAgentFilePath)) {
      fs.openSync(stopAgentFilePath, 'w')
    }

    return { code: 'success' }
  } catch (err) {
    // if this doesn't work because of an error, we should throw, but handle this in the caller
    return { code: 'error', detail: err }
  }
}

export const getShouldStopAgent = ({
  agentName,
}: {
  agentName: string
}): boolean => {
  const boxCiDir = getBoxCiDir()

  const candidateStopAgentFilePath = paths.stopAgentMetaFile(
    boxCiDir,
    agentName,
  )

  try {
    // if the marker stop agent meta file exists, it means to stop
    return fs.existsSync(candidateStopAgentFilePath)
  } catch (err) {
    // on error just return false
    return false
  }
}

// clean up stop agent meta files that are no longer needed
export const cleanStopAgentMetaFile = ({
  agentName,
}: {
  agentName: string
}) => {
  const boxCiDir = getBoxCiDir()

  try {
    fs.unlinkSync(paths.stopAgentMetaFile(boxCiDir, agentName))
  } catch {
    // just do nothing on error - no need to throw error if cleanup of this small file doesn't work
  }
}

export const clearBuildLogsAndThrowOnFsError = ({
  buildId,
}: {
  buildId: string
}) => {
  const boxCiDir = getBoxCiDir()

  const buildLogsDir = paths.buildLogsDir(boxCiDir, buildId)
  const logFile = `${buildLogsDir}/${filenameUtils.logsFile({ buildId })}`
  const eventsFile = `${buildLogsDir}/${filenameUtils.eventsFile({ buildId })}`

  // delete the files one by one - just throw on error and handle in parent
  //
  // note if they don't exist, due to perhaps being manually deleted etc, then just do nothing

  if (fs.existsSync(logFile)) {
    fs.unlinkSync(logFile)
  }

  if (fs.existsSync(eventsFile)) {
    fs.unlinkSync(eventsFile)
  }

  if (fs.existsSync(buildLogsDir)) {
    fs.rmdirSync(buildLogsDir)
  }

  // once logs are deleted, add this to the build metadata
  writeBuildLogsClearedMeta({ buildId })
}
