import {
  buildPostReturningJson,
  buildPostReturningNothing,
  buildPostReturningJsonIfPresent,
} from './http'
import { ProjectConfig } from './config'

export type ProjectBuildTask = {
  n: string
  c: string
}

export type TaskLogs = {
  r: number
  t: number
  l: string
}

export type ProjectBuildPipeline = {
  n: string
  t: ProjectBuildTask[]
}

export type ProjectBuild = {
  id: string
  projectId: string
  pipeline: ProjectBuildPipeline
  taskLogs: Array<TaskLogs>
  gitCommit: string
  gitBranch: string
  gitTag: string
  agentName: string
  cancelled?: boolean
  timedOut?: boolean
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
  agentName: string
}

export type RunProjectBuildAgentRequestBody = {
  agentName: string
}

export type ProjectBuildAddPipelineRequestBody = {
  projectBuildId: string
  pipeline: ProjectBuildPipeline
}

export type LogsChunk = {
  c: string
  l: number
  t: number
}

export type AddProjectBuildTaskLogsRequestBody = {
  id: string
  i: number
  l: string
}

export type AddProjectBuildTaskLogsResponseBody = {
  cancelled: boolean // flag for if the build was cancelled
  timedOut: boolean // flag for if build timed out
}

export type ProjectBuildPipelineDoneRequestBody = {
  projectBuildId: string
  pipelineReturnCode: number
  pipelineRuntimeMillis: number
}

export type ProjectBuildNoMatchingPipelineRequestBody = {
  projectBuildId: string
}

export type ProjectBuildGitCommitNotFoundRequestBody = {
  projectBuildId: string
}

export type LogsMetaTask = {
  r: number
  t: number
  co: number
  ce: number
}

export type ProjectBuildTaskStartedRequestBody = {
  projectBuildId: string
  taskIndex: number
}

export type ProjectBuildTaskDoneRequestBody = {
  projectBuildId: string
  taskIndex: number
  commandReturnCode: number
  commandRuntimeMillis: number
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
  setProjectBuildTaskStarted: buildPostReturningNothing<ProjectBuildTaskStartedRequestBody>(config, '/task-started'),
  setProjectBuildTaskDone: buildPostReturningNothing<ProjectBuildTaskDoneRequestBody>(config, '/task-done'),
  setProjectBuildPipelineDone: buildPostReturningNothing<ProjectBuildPipelineDoneRequestBody>(config, '/pipeline-done'),
  setProjectBuildNoMatchingPipeline: buildPostReturningNothing<ProjectBuildNoMatchingPipelineRequestBody>(config, '/no-matching-pipeline'),
  setProjectBuildGitCommitNotFound: buildPostReturningNothing<ProjectBuildGitCommitNotFoundRequestBody>(config, '/commit-not-found'),
  getProject: buildPostReturningJson<void, Project>(config, '/project'),
})

export type Api = ReturnType<typeof buildApi>
