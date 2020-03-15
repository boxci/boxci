import { buildPost, RetriesConfig } from './http'

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

export type GetProjectRequestBody = {
  agentName: string
}

export type GetProjectBuildToRunRequestBody = {
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

export type AddLogsRequestBody = {
  id: string
  i: number
  l: string
}

export type AddLogsResponseBody = {
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

export type SetProjectBuildGitBranchRequestBody = {
  projectBuildId: string
  gitBranch: string
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

export const DEFAULT_RETRIES: RetriesConfig = {
  period: 5000, // 5 seconds between retries
  max: 6, // 30 seconds of retries
}

// prettier-ignore
export const api = {
  // endpoints to get project and project builds
  getProject: buildPost<GetProjectRequestBody, Project>('/project'),
  getProjectBuildToRun: buildPost<GetProjectBuildToRunRequestBody, ProjectBuild>('/agent'),

  // endpoints to update build data before / after running it (or not running it)
  setProjectBuildPipeline: buildPost<ProjectBuildAddPipelineRequestBody, void>('/pipeline'),
  setProjectBuildGitBranch: buildPost<SetProjectBuildGitBranchRequestBody, void>('/set-git-branch'),
  setProjectBuildNoMatchingPipeline: buildPost<ProjectBuildNoMatchingPipelineRequestBody, void>('/no-matching-pipeline'),
  setProjectBuildGitCommitNotFound: buildPost<ProjectBuildGitCommitNotFoundRequestBody, void>('/commit-not-found'),
  setProjectBuildPipelineDone: buildPost<ProjectBuildPipelineDoneRequestBody, void>('/pipeline-done'),

  // endpoints for updating progress on build tasks
  setProjectBuildTaskStarted: buildPost<ProjectBuildTaskStartedRequestBody, void>('/task-started'),
  addLogs: buildPost<AddLogsRequestBody, AddLogsResponseBody>('/logs'),
  setProjectBuildTaskDone: buildPost<ProjectBuildTaskDoneRequestBody, void>('/task-done'),
}

export type Api = typeof api
