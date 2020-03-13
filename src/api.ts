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

const DEFAULT_RETRY_PERIOD = 5000
const DEFAULT_MAX_RETRIES = 4

// prettier-ignore
export const buildApi = (config: ProjectConfig) => ({
  // endpoints to get project and project builds
  getProject:
    buildPostReturningJson<GetProjectRequestBody, Project>(
      '/project',
      config,
      10000,
      6 // retry for one minute before giving up
    ),
  getProjectBuildToRun:
    buildPostReturningJsonIfPresent<GetProjectBuildToRunRequestBody, ProjectBuild>(
      '/agent',
      config,
      DEFAULT_RETRY_PERIOD,
      0 // don't retry - this is retried in a loop anyway
    ),

  // endpoints to update build data before / after running it (or not running it)
  setProjectBuildPipeline:
    buildPostReturningNothing<ProjectBuildAddPipelineRequestBody>(
      '/pipeline',
      config,
      DEFAULT_RETRY_PERIOD,
      DEFAULT_MAX_RETRIES
    ),
  setProjectBuildGitBranch:
    buildPostReturningNothing<SetProjectBuildGitBranchRequestBody>(
      '/set-git-branch',
      config,
      DEFAULT_RETRY_PERIOD,
      DEFAULT_MAX_RETRIES
    ),
  setProjectBuildNoMatchingPipeline:
    buildPostReturningNothing<ProjectBuildNoMatchingPipelineRequestBody>(
      '/no-matching-pipeline',
      config,
      DEFAULT_RETRY_PERIOD,
      DEFAULT_MAX_RETRIES
    ),
  setProjectBuildGitCommitNotFound:
    buildPostReturningNothing<ProjectBuildGitCommitNotFoundRequestBody>(
      '/commit-not-found',
      config,
      DEFAULT_RETRY_PERIOD,
      DEFAULT_MAX_RETRIES
    ),
  setProjectBuildPipelineDone:
    buildPostReturningNothing<ProjectBuildPipelineDoneRequestBody>(
      '/pipeline-done',
      config,
      DEFAULT_RETRY_PERIOD,
      DEFAULT_MAX_RETRIES
    ),

  // endpoints for updating progress on build tasks
  setProjectBuildTaskStarted:
    buildPostReturningNothing<ProjectBuildTaskStartedRequestBody>(
      '/task-started',
      config,
      DEFAULT_RETRY_PERIOD,
      DEFAULT_MAX_RETRIES
    ),
  addLogs:
    buildPostReturningJsonIfPresent<AddLogsRequestBody, AddLogsResponseBody>(
      '/logs',
      config,
      DEFAULT_RETRY_PERIOD,
      0 // by default don't retry - this is retried in a loop anyway, this can be overridden for last request
    ),
  setProjectBuildTaskDone:
    buildPostReturningNothing<ProjectBuildTaskDoneRequestBody>(
      '/task-done',
      config,
      DEFAULT_RETRY_PERIOD,
      DEFAULT_MAX_RETRIES
    ),
})

export type Api = ReturnType<typeof buildApi>
