import { ProjectBuild } from './api'

const isString = (candidate: any) => typeof candidate === 'string'

const validGitCommit = (candidate: string): boolean => {
  if (!candidate || !isString(candidate)) {
    return false
  }

  return true
}

const validProjectBuildId = (candidate: string | undefined): boolean =>
  !!candidate &&
  isString(candidate) &&
  candidate.length === 12 &&
  candidate.charAt(0) === 'B'

export default {
  projectBuild: (candidate: any): ProjectBuild | undefined => {
    const projectBuild: ProjectBuild = candidate as ProjectBuild

    if (
      validProjectBuildId(projectBuild.id) && // id is valid
      validGitCommit(projectBuild.gitCommit) && // git commit is valid
      !projectBuild.cancelled && // build not cancelled
      !projectBuild.timedOut // build not timed out
    ) {
      return projectBuild
    }
  },
}
