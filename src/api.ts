import 'isomorphic-fetch'
import { buildPostReturningJson, buildPostReturningNothing } from './http'
import { Config, ProjectBuildLabel } from './config'

export type LogType = 'stdout' | 'stderr'

export type StartRequestBody = {
  commandString: string
  labels: Array<ProjectBuildLabel>
}

export type RunRequestResponse = {
  projectBuildId: string
}

export type LogsChunk = {
  c: string
  t: number
  l: number
}

export type LogsRequestBody = {
  id: string
  t: LogType
  i: number
  c: LogsChunk
}

export type DoneRequestBody = {
  projectBuildId: string
  commandReturnCode: number
  commandRuntimeMillis: number
  commandLogsTotalChunksStdout: number
  commandLogsTotalChunksStderr: number
  commandLogsAvailableStdout: boolean
  commandLogsAvailableStderr: boolean
}

// prettier-ignore
export const buildApi = (config: Config) => ({
  start: buildPostReturningJson<StartRequestBody, RunRequestResponse>(config, '/start'),
  logs: buildPostReturningNothing<LogsRequestBody>(config, '/logs'),
  done: buildPostReturningNothing<DoneRequestBody>(config, '/done'),
})

export type Api = ReturnType<typeof buildApi>
