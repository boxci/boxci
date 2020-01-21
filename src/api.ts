import {
  buildPostReturningJson,
  buildPostReturningNothing,
  buildPostReturningJsonIfPresent,
} from './http'
import { Config } from './config'

export type ProjectBuild = {
  id: string
  projectId: string
  commandString: string
  gitCommit: string
  gitBranch: string
  gitTag: string
  machineName: string
}

export type Project = {
  id: string
  gitRepoSshUrl: string
  gitRepoLink: string
  repoType: 'GITHUB' | 'GITLAB'
}

export type LogType = 'stdout' | 'stderr'

export type RunProjectBuildDirectRequestBody = {
  gitBranch: string
  gitCommit: string
  machineName: string
}

export type RunProjectBuildAgentRequestBody = {
  machineName: string
}

export type ProjectBuildAddCommandRequestBody = {
  projectBuildId: string
  commandString: string
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
  setProjectBuildCommand: buildPostReturningNothing<ProjectBuildAddCommandRequestBody>(config, '/command'),
  getProject: buildPostReturningJson<void, Project>(config, '/project'),
})

export type Api = ReturnType<typeof buildApi>
