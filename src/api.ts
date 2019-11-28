import {
  buildPostReturningJson,
  buildPostReturningNothing,
  buildPostReturningJsonIfPresent,
} from './http'
import { Config, ProjectBuildLabel } from './config'

export type ProjectBuild = {
  id: string
  projectId: string
  commandString: string
  gitCommit: string
  gitBranch: string
  gitRepoUrl: string
  machineName: string
}

export type LogType = 'stdout' | 'stderr'

export type RunProjectBuildDirectRequestBody = {
  gitBranch: string
  gitCommit: string
  gitRepoUrl: string
  machineName: string
  commandString: string
}

export type RunProjectBuildAgentRequestBody = {
  machineName: string
}

export type LogsChunk = {
  c: string
  t: number
  l: number
}

export type AddProjectBuildLogsRequestBody = {
  id: string
  t: LogType
  i: number
  c: LogsChunk
}

export type AddProjectBuildLogsResponseBody = {
  cancelled: boolean // flag for if the build was cancelled
  timedOut: boolean // flag for if build timed out
}

export type ProjectBuildDoneRequestBody = {
  projectBuildId: string
  commandReturnCode: number
  commandRuntimeMillis: number
  commandLogsTotalChunksStdout: number
  commandLogsTotalChunksStderr: number
  commandLogsAvailableStdout: boolean
  commandLogsAvailableStderr: boolean
}

export type ProjectType = 'NONE' | 'GIT'

export interface ProjectBuildLabel {
  name: string
  value: string
}

export type FetchBuildJobResponse = {
  projectBuildId: string
  commandString: string
  labels: ProjectBuildLabel[]
  projectType: ProjectType
}

// prettier-ignore
export const buildApi = (config: Config) => ({
  runProjectBuildDirect: buildPostReturningJson<RunProjectBuildDirectRequestBody, ProjectBuild>(config, '/direct'),
  runProjectBuildAgent: buildPostReturningJsonIfPresent<RunProjectBuildAgentRequestBody, ProjectBuild>(config, '/agent'),
  addProjectBuildLogs: buildPostReturningJsonIfPresent<AddProjectBuildLogsRequestBody, AddProjectBuildLogsResponseBody>(config, '/logs'),
  setProjectBuildDone: buildPostReturningNothing<ProjectBuildDoneRequestBody>(config, '/done'),
})

export type Api = ReturnType<typeof buildApi>
