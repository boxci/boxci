import { Yellow, Bright } from './consoleFonts'
import { printErrorAndExit } from './logging'
import {
  clearBuildLogsAndThrowOnFsError,
  readHistory,
  BuildMeta,
  getBoxCiDir,
  paths,
  readMetaFromDir,
} from './data'
import fs from 'fs'

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

const cleanBuildLogs = ({
  buildId,
}: {
  buildId: string
}): { err?: Error; clearedAt?: number } | undefined => {
  // for this method, check the buildId actually exists, and the build's logs were not already cleared
  const boxCiDir = getBoxCiDir()

  const buildMetaDir = paths.buildMetaDir(boxCiDir, buildId)
  let buildExists = false
  try {
    buildExists = fs.existsSync(buildMetaDir)
  } catch {
    // on error just say build does not exist
  }

  if (!buildExists) {
    printErrorAndExit(`Build ${Bright(buildId)} does not exist. Is the ID correct?`) // prettier-ignore
  }

  const buildMeta = readMetaFromDir<BuildMeta>(
    paths.buildMetaDir(boxCiDir, buildId),
  ).meta

  if (buildMeta.l !== undefined) {
    return { clearedAt: buildMeta.l }
  }

  try {
    clearBuildLogsAndThrowOnFsError({ buildId })
  } catch (err) {
    return { err }
  }
}

const cleanAllBuildLogsForProject = ({
  projectId,
}: {
  projectId: string
}): {
  buildLogsCleared: Array<BuildMeta>
  errors: Array<{ build: BuildMeta; err: Error }>
  noBuildsToClean?: boolean // when there are literally no builds in the history for the project, print a special message
  allBuildAlreadyCleaned?: boolean // when there are builds for the project, but they have all been cleaned already, print a special message
} => {
  const history = readHistory()

  let builds = history.builds.filter((build) => build.p === projectId)

  if (builds.length === 0) {
    return {
      buildLogsCleared: [],
      errors: [],
      noBuildsToClean: true,
    }
  }

  builds = builds.filter((build) => build.l === undefined)

  if (builds.length === 0) {
    return {
      buildLogsCleared: [],
      errors: [],
      allBuildAlreadyCleaned: true,
    }
  }

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

const cleanAllBuildLogs = (): {
  buildLogsCleared: Array<BuildMeta>
  errors: Array<{ build: BuildMeta; err: Error }>
  noBuildsToClean?: boolean // when there are literally no builds in the history, print a special message
  allBuildAlreadyCleaned?: boolean // when there are builds, but they have all been cleaned already, print a special message
} => {
  const history = readHistory()

  if (history.builds.length === 0) {
    return {
      buildLogsCleared: [],
      errors: [],
      noBuildsToClean: true,
    }
  }

  const builds = history.builds.filter((build) => build.l === undefined)

  if (builds.length === 0) {
    return {
      buildLogsCleared: [],
      errors: [],
      allBuildAlreadyCleaned: true,
    }
  }

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

export default {
  validateArgs,
  cleanBuildLogs,
  cleanAllBuildLogsForProject,
  cleanAllBuildLogs,
}
