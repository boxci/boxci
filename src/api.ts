import {
  buildPostReturningJson,
  buildPostReturningNothing,
  buildPostReturningJsonIfPresent,
} from './http'
import { ProjectConfig } from './config'

export type ProjectBuildTask = {
  name: string
  command: string
}

export type ProjectBuildPipeline = {
  name: string
  tasks: ProjectBuildTask[]
}

export type ProjectBuild = {
  id: string
  projectId: string
  pipeline: ProjectBuildPipeline
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

export type ProjectBuildAddPipelineRequestBody = {
  projectBuildId: string
  pipeline: ProjectBuildPipeline
}

export type LogsChunk = {
  c: string
  l: number
}

export type AddProjectBuildTaskLogsRequestBody = {
  id: string
  t: LogType
  ci: number
  ti: number
  c: LogsChunk
}

export type AddProjectBuildTaskLogsResponseBody = {
  cancelled: boolean // flag for if the build was cancelled
  timedOut: boolean // flag for if build timed out
}

export type ProjectBuildPipelineDoneRequestBody = {
  projectBuildId: string
  pieplineReturnCode: number
  pipelineRuntimeMillis: number
}

export type ProjectBuildNoMatchingPipelineRequestBody = {
  projectBuildId: string
}

export type LogsMetaTask = {
  r: number
  t: number
  co: number
  ce: number
}

export type ProjectBuildTaskDoneRequestBody = {
  projectBuildId: string
  taskIndex: number
  logsMeta: LogsMetaTask
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
export const buildApi = (config: ProjectConfig) => ({
  runProjectBuildDirect: buildPostReturningJson<RunProjectBuildDirectRequestBody, ProjectBuild>(config, '/direct'),
  runProjectBuildAgent: buildPostReturningJsonIfPresent<RunProjectBuildAgentRequestBody, ProjectBuild>(config, '/agent'),
  addProjectBuildTaskLogs: buildPostReturningJsonIfPresent<AddProjectBuildTaskLogsRequestBody, AddProjectBuildTaskLogsResponseBody>(config, '/logs'),
  setProjectBuildPipeline: buildPostReturningNothing<ProjectBuildAddPipelineRequestBody>(config, '/pipeline'),
  setProjectBuildTaskDone: buildPostReturningNothing<ProjectBuildTaskDoneRequestBody>(config, '/task-done'),
  setProjectBuildPipelineDone: buildPostReturningNothing<ProjectBuildPipelineDoneRequestBody>(config, '/pipeline-done'),
  setProjectBuildNoMatchingPipeline: buildPostReturningNothing<ProjectBuildNoMatchingPipelineRequestBody>(config, '/no-matching-pipeline'),
  getProject: buildPostReturningJson<void, Project>(config, '/project'),
})

export type Api = ReturnType<typeof buildApi>
