import 'isomorphic-fetch'
import {
  buildPostReturningJson,
  buildPostReturningNothing,
  buildPostReturningJsonIfPresent,
} from './http'
import { Config, ProjectBuildLabel } from './config'

export type LogType = 'stdout' | 'stderr'

export type RunProjectBuildDirectRequestBody = {
  gitBranch: string
  gitCommit: string
  machineName: string
}

export type RunProjectBuildAgentRequestBody = {
  machineName: string
}

export type RunProjectBuildDirectResponse = {
  commandString: string
  projectBuildId: string
}

export type RunProjectBuildAgentResponse =
  | {
      projectBuildId: string
      gitBranch: string
      gitCommit: string
      commandString: string
    }
  | undefined

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
  runProjectBuildDirect: buildPostReturningJson<RunProjectBuildDirectRequestBody, RunProjectBuildDirectResponse>(config, '/direct'),
  runProjectBuildAgent: buildPostReturningJsonIfPresent<RunProjectBuildAgentRequestBody, RunProjectBuildAgentResponse>(config, '/agent'),
  addProjectBuildLogs: buildPostReturningNothing<AddProjectBuildLogsRequestBody>(config, '/logs'),
  setProjectBuildDone: buildPostReturningNothing<ProjectBuildDoneRequestBody>(config, '/done'),
})

export type Api = ReturnType<typeof buildApi>
