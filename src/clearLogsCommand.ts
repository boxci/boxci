import { Yellow, Bright } from './consoleFonts'
import { printErrorAndExit } from './logging'
import {
  clearBuildLogsAndThrowOnFsError,
  readHistory,
  BuildMeta,
} from './data2'

export type ClearLogsCommandArgs = {
  buildId: string
  projectId: string
  all: boolean
}

const validateArgs = ({
  options,
}: {
  options: {
    project: string
    build: string
    all: boolean
  }
}): ClearLogsCommandArgs => {
  const validationErrors = []

  let optionsSet = 0
  if (!!options.all) optionsSet++
  if (!!options.project) optionsSet++
  if (!!options.build) optionsSet++

  if (optionsSet === 0) {
    printErrorAndExit(`One of ${Yellow('--build')}, ${Yellow('--project')}, ${Yellow('--all')} must be set`) // prettier-ignore
  } else if (optionsSet > 1) {
    printErrorAndExit(`Only one of ${Yellow('--build')}, ${Yellow('--project')}, ${Yellow('--all')} can be set`) // prettier-ignore
  }

  let buildId = options.build ?? ''

  if (buildId !== undefined) {
    buildId = buildId + '' // convert to string

    if (buildId.charAt(0) !== 'B' || buildId.length !== 12) {
      validationErrors.push(`  - ${Yellow('--build')} must be 12 characters long and start with B`) // prettier-ignore
    }
  }

  let projectId = options.project ?? ''

  if (projectId !== undefined) {
    projectId = projectId + '' // convert to string

    if (buildId.charAt(0) !== 'P' || buildId.length !== 8) {
      validationErrors.push(`  - ${Yellow('--project')} must be 8 characters long and start with P`) // prettier-ignore
    }
  }

  return {
    projectId,
    buildId,
    all: !!options.all,
  }
}

const clearBuildLogs = ({
  buildId,
}: {
  buildId: string
}): Error | undefined => {
  try {
    clearBuildLogsAndThrowOnFsError({ buildId })
  } catch (err) {
    return err
  }
}

const clearAllProjectBuildLogs = ({
  projectId,
}: {
  projectId: string
}): {
  buildLogsCleared: Array<BuildMeta>
  errors: Array<{ build: BuildMeta; err: Error }>
} => {
  const history = readHistory()

  const builds = history.builds.filter((build) => build.p === projectId)

  const buildLogsCleared: Array<BuildMeta> = []
  const errors: Array<{ build: BuildMeta; err: Error }> = []

  for (let build of builds) {
    try {
      clearBuildLogsAndThrowOnFsError({ buildId: build.id })

      buildLogsCleared.push(build)
    } catch (err) {
      // just collect errors, keep trying to delete other build logs, and report errors at end
      errors.push({ build, err })
    }
  }

  return {
    buildLogsCleared,
    errors,
  }
}

const clearAllBuildLogs = (): {
  buildLogsCleared: Array<BuildMeta>
  errors: Array<{ build: BuildMeta; err: Error }>
} => {
  const history = readHistory()

  const buildLogsCleared: Array<BuildMeta> = []
  const errors: Array<{ build: BuildMeta; err: Error }> = []

  for (let build of history.builds) {
    try {
      clearBuildLogsAndThrowOnFsError({ buildId: build.id })

      buildLogsCleared.push(build)
    } catch (err) {
      // just collect errors, keep trying to delete other build logs, and report errors at end
      errors.push({ build, err })
    }
  }

  return {
    buildLogsCleared,
    errors,
  }
}

export default {
  validateArgs,
  clearBuildLogs,
  clearAllProjectBuildLogs,
  clearAllBuildLogs,
}
