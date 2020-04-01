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
  rerunId?: string
}

export type Project = {
  id: string
  gitRepoSshUrl: string
  gitRepoLink: string
  repoType: 'GITHUB' | 'GITLAB'
}

export type LogType = 'stdout' | 'stderr'

export type GetProjectRequestBody = {
  n: string
  v: string
}

export type GetProjectBuildToRunRequestBody = {
  n: string
  v: string
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

export type StopAgentResponse = {
  __stop__agent: boolean
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

export type SetErrorGitCommitNotFoundRequestDto = {
  projectBuildId: string
  gitRepoSshUrl: string
}

export type SetProjectBuildGitBranchRequestBody = {
  projectBuildId: string
  gitBranch: string
}

export type SetProjectBuildErrorPreparingRequestDto = {
  projectBuildId: string
  errorMessage: string
}

export type SetErrorCloningRepositoryRequestDto = {
  projectBuildId: string
  gitRepoSshUrl: string
}

export type SetErrorFetchingRepositoryRequestDto = {
  projectBuildId: string
  gitRepoSshUrl: string
}

export type GetManifestRequestDto = {
  v: string
}

export type GetManifestResponseDto = {
  thisVersion: string
  latestVersion: string
  manifest: {
    l: boolean
    w?: 1 | 2 | 3
    is?: string[]
  }
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

export type ProjectAgentStoppedRequestDto = {
  projectBuildId: string
  agentName: string
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
export default {
  // endpoints to get project and project builds
  getProject: buildPost<GetProjectRequestBody, Project>('/project'),
  getProjectBuildToRun: buildPost<GetProjectBuildToRunRequestBody, ProjectBuild | StopAgentResponse>('/agent'),

  // endpoints to update build data before / after running it (or not running it)
  setProjectBuildErrorPreparing: buildPost<SetProjectBuildErrorPreparingRequestDto, void>('/set-error-preparing'),
  setProjectBuildErrorCloningRepository: buildPost<SetErrorCloningRepositoryRequestDto, void>('/set-error-cloning-repository'),
  setProjectBuildErrorFetchingRepository: buildPost<SetErrorFetchingRepositoryRequestDto, void>('/set-error-fetching-repository'),
  setProjectBuildErrorGitCommitNotFound: buildPost<SetErrorGitCommitNotFoundRequestDto, void>('/set-error-commit-not-found'),
  setProjectBuildPipeline: buildPost<ProjectBuildAddPipelineRequestBody, void>('/pipeline'),
  setProjectBuildGitBranch: buildPost<SetProjectBuildGitBranchRequestBody, void>('/set-git-branch'),
  setProjectBuildNoMatchingPipeline: buildPost<ProjectBuildNoMatchingPipelineRequestBody, void>('/no-matching-pipeline'),
  setProjectBuildPipelineDone: buildPost<ProjectBuildPipelineDoneRequestBody, void>('/pipeline-done'),

  // endpoints for updating progress on build tasks
  setProjectBuildTaskStarted: buildPost<ProjectBuildTaskStartedRequestBody, void>('/task-started'),
  addLogs: buildPost<AddLogsRequestBody, AddLogsResponseBody>('/logs'),
  setProjectBuildTaskDone: buildPost<ProjectBuildTaskDoneRequestBody, void>('/task-done'),

  // other endpoints
  getManifest: buildPost<GetManifestRequestDto, GetManifestResponseDto>('/manifest'),
  setAgentStopped: buildPost<ProjectAgentStoppedRequestDto, void>('/agent-stopped')
}
