import { Yellow, Bright } from '../consoleFonts'
import { printErrorAndExit, formattedTime } from '../logging'
import {
  clearBuildLogsAndThrowOnFsError,
  readHistory,
  BuildMeta,
  getBoxCiDir,
  paths,
  readMetaFromDir,
} from '../data'
import fs from 'fs'
import { Command } from 'commander'

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
    printErrorAndExit({ silent: true }, `One of ${Yellow('--build')}, ${Yellow('--project')}, ${Yellow('--all')} must be set`) // prettier-ignore
  } else if (optionsSet > 1) {
    printErrorAndExit({ silent: true }, `Only one of ${Yellow('--build')}, ${Yellow('--project')}, ${Yellow('--all')} can be set`) // prettier-ignore
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
  const boxCiDir = getBoxCiDir({ silent: true })

  const buildMetaDir = paths.buildMetaDir(boxCiDir, buildId)
  let buildExists = false
  try {
    buildExists = fs.existsSync(buildMetaDir)
  } catch {
    // on error just say build does not exist
  }

  if (!buildExists) {
    printErrorAndExit({ silent: true },`Build ${Bright(buildId)} does not exist. Is the ID correct?`) // prettier-ignore
  }

  const buildMeta = readMetaFromDir<BuildMeta>(
    { silent: true },
    paths.buildMetaDir(boxCiDir, buildId),
  ).meta

  if (buildMeta.l !== undefined) {
    return { clearedAt: buildMeta.l }
  }

  try {
    clearBuildLogsAndThrowOnFsError({
      agentConfig: { silent: true },
      buildId,
    })
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
  const history = readHistory({ silent: true })

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
      clearBuildLogsAndThrowOnFsError({
        agentConfig: { silent: true },
        buildId: build.id,
      })

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
  const history = readHistory({ silent: true })

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
      clearBuildLogsAndThrowOnFsError({
        agentConfig: { silent: false },
        buildId: build.id,
      })

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

export default ({
  cli,
  commandMatched,
}: {
  cli: Command
  commandMatched: () => void
}) => {
  cli
    .command('clean-logs')

    // optional options - only one of these can be specified, this is validated below
    .option('-b, --build <arg>')
    .option('-p, --project <arg>')
    .option('-a, --all')

    .action((options: { build: string; project: string; all: boolean }) => {
      commandMatched()

      console.log('')

      const args = validateArgs({ options })

      if (args.buildId) {
        const result = cleanBuildLogs({
          buildId: args.buildId,
        })

        if (result === undefined) {
          console.log(`Cleaned logs for build ${Bright(args.buildId)}\n\n`)
        } else if (result.err) {
          printErrorAndExit({ silent: false }, `Could not clean logs for build ${Bright( args.buildId )}\n\nCause:\n\n${result.err}`) // prettier-ignore
        } else if (result.clearedAt) {
          console.log(`Already cleaned logs for build ${Bright(args.buildId)} (on ${formattedTime(result.clearedAt, 'at')})\n\n`) // prettier-ignore
        }

        console.log('\n')

        return
      }

      if (args.projectId) {
        const result = cleanAllBuildLogsForProject({
          projectId: args.projectId,
        })

        if (result.noBuildsToClean) {
          // TODO
          //
          // for better messaging here we can check the agent metadata to check
          // if an agent has ever been run for this project on this machine,
          //
          // i.e. if so the ID is more likely wrong / a typo, because we never even had agents for that project running
          // on this machine,
          // whereas if not then simply no builds have run yet on this machine (there might be agents spread across machines
          // so running the clean command on all machines makes more sense and it's it doesn't suggest the project ID is wrong or a typo)
          console.log(`No builds found for project ${Bright(args.projectId)}.\n\n`) // prettier-ignore

          return
        } else if (result.allBuildAlreadyCleaned) {
          console.log(`Logs already cleaned for all build for project ${Bright(args.projectId)}.\n\n`) // prettier-ignore

          return
        }

        let message = ''

        if (result.buildLogsCleared.length > 0) {
          message += `Cleaned logs for ${result.buildLogsCleared.length} builds for project ${Bright(args.projectId)}:\n` // prettier-ignore

          result.buildLogsCleared.forEach((build) => {
            message += `\n${build.id}`
          })
        }

        if (result.errors.length > 0) {
          if (result.buildLogsCleared.length > 0) {
            message += '\n\n'
          }

          message += `Could not clean logs for ${result.errors.length} builds:\n`

          result.errors.forEach(({ build, err }) => {
            message += `\n\n${build.id}\n\nError:\n\n${err}`
          })
        }

        message += '\n\n'

        console.log(message)

        return
      }

      if (args.all) {
        const result = cleanAllBuildLogs()

        if (result.noBuildsToClean) {
          console.log(`No builds have run yet on this machine.\n\n`) // prettier-ignore

          return
        } else if (result.allBuildAlreadyCleaned) {
          console.log(`Logs already cleaned for all builds on this machine.\n\n`) // prettier-ignore

          return
        }

        let message = ''

        if (result.buildLogsCleared.length > 0) {
          message += `Cleaned logs for ${result.buildLogsCleared.length} builds:\n`

          result.buildLogsCleared.forEach((build) => {
            message += `\n${build.id}`
          })
        }

        if (result.errors.length > 0) {
          if (result.buildLogsCleared.length > 0) {
            message += '\n\n'
          }

          message += `Could not clean logs for ${result.errors.length} builds:\n`

          result.errors.forEach(({ build, err }) => {
            message += `\n\n${build.id}\n\nError:\n\n${err}`
          })
        }

        message += '\n\n'

        console.log(message)

        return
      }
    })
}
