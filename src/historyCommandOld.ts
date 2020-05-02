// import { readHistory, deleteLogs } from './data2'
// import { Bright, Yellow, LightBlue } from './consoleFonts'
// import { printErrorAndExit, formattedStartTime } from './logging'

// export type HistoryCommandArgs = {
//   latest: number
//   agentName?: string
// }

// export type CleanHistoryCommandArgs = {
//   dryRun: boolean
//   hardDelete: boolean
//   agentName?: string
//   buildId?: string
// }

// const HISTORY_COMMAND_LAST_OPTION_DEFAULT = '10'

// const validateArgs = ({
//   agent,
//   options,
// }: {
//   agent: string | undefined
//   options: { latest: string }
// }): HistoryCommandArgs => {
//   const validationErrors: Array<string> = []

//   let latest: number = 0

//   try {
//     latest = parseInt(options.latest ?? HISTORY_COMMAND_LAST_OPTION_DEFAULT)

//     if (latest < 1) {
//       validationErrors.push(`  - ${Yellow('--latest (-l)')} must be a positive integer`) // prettier-ignore
//     }
//   } catch (err) {
//     validationErrors.push(`  - ${Yellow('--latest (-l)')} must be a positive integer`) // prettier-ignore
//   }

//   if (agent !== undefined) {
//     agent = agent + '' // convert to string

//     if (agent.length > 32) {
//       validationErrors.push(`  - ${Yellow('agent name')} (1st argument) cannot be longer than 32 characters`) // prettier-ignore
//     }
//   }

//   if (validationErrors.length > 0) {
//     printErrorAndExit(validationErrors.join('\n'))
//   }

//   return {
//     latest,
//     ...(agent !== undefined && { agentName: agent }),
//   }
// }

// // prettier-ignore
// const printAgentHistory = (agentHistory: AgentHistory): string => {
//   const projectLink = `https://boxci.dev/p/${agentHistory.info.project}`

//   let output = `│ ${Bright(agentHistory.info.agentName)}\n`
//   output +=    `│\n`
//   output +=    `│ Project    ${LightBlue(projectLink)}\n`
//   output +=    `│ Started    ${formattedStartTime(agentHistory.info.startTime)}\n`
//   output +=    `│ Builds     ${agentHistory.numberOfBuilds}\n`
//   output +=    `│ History    ${Yellow(`boxci history ${agentHistory.info.agentName}`)}\n`
//   output +=    '\n'

//   return output
// }

// // prettier-ignore
// const printBuildHistory = ({agentHistory, buildHistory }:{ agentHistory: AgentHistory, buildHistory: BuildHistory }): string => {
//   const buildLink = `https://boxci.dev/p/${agentHistory.info.project}/${buildHistory.info.id}`

//   let output = `│ ${Bright(`Build ${buildHistory.info.id}`)}\n`
//   output +=    `│\n`
//   output +=    `│ Started   ${formattedStartTime(buildHistory.info.startTime)}\n`
//   output +=    `│ Link      ${LightBlue(buildLink)}\n`
//   output +=    `│ Logs      ${Yellow(`cat $(boxci logs ${buildHistory.info.id})`)}\n`
//   output +=    '\n'

//   return output
// }

// const fullHistory = ({
//   latest,
// }: {
//   latest: number
// }): {
//   history: History
//   output: string | undefined
// } => {
//   const history = readHistory()

//   let output = ''

//   history.agents.slice(0, latest).forEach((agentHistory) => {
//     output += printAgentHistory(agentHistory)
//   })

//   return {
//     history,
//     output: output || undefined,
//   }
// }

// const agentHistory = ({
//   latest,
//   agentName,
//   failSilently,
// }: {
//   latest: number
//   agentName: string
//   failSilently?: boolean
// }): {
//   agentHistory: AgentHistory
//   output: string | undefined
// } => {
//   const agentHistory = readAgentHistory({ agentName })

//   // if undefined, the agent history does not exist
//   if (agentHistory === undefined) {
//     if (failSilently) {
//       // if failSilently flag set, don't throw an error if agent history
//       // doesn't exist - return undefined and handle the error in the parent
//       return {
//         // @ts-ignore
//         agentHistory: undefined,
//         output: undefined,
//       }
//     }

//     printErrorAndExit(
//       `No history found for ${Bright(agentName)}\n\n` +
//         `The agent name may be incorrect, or its history may have been deleted.`,
//     )

//     return undefined as never
//   }

//   let output = ''

//   agentHistory.builds?.slice(0, latest).forEach((buildHistory) => {
//     output += printBuildHistory({ agentHistory, buildHistory })
//   })

//   return {
//     agentHistory,
//     output: output || undefined,
//   }
// }

// // IMPORTANT - only works while agent build dir name is equal to build ID
// // but this is important as it speeds up the search a lot - don't have to
// // read all the info files to get IDs
// const findAgentBuild = ({
//   buildId,
// }: {
//   buildId: string
// }): { agentName: string; agentBuildDirPath: string } | undefined => {
//   try {
//     const boxCiDir = getBoxCiDir({ spinner: undefined, failSilently: true })

//     if (boxCiDir === undefined) {
//       return
//     }

//     const agentDirsMeta = getAgentDirsMeta(boxCiDir)

//     // fail silently by returning undefined if any kind of issue
//     if (agentDirsMeta === undefined) {
//       return
//     }

//     // iterate through until the path for the build's directory is found
//     for (let { name: agentName, path: agentDirPath } of agentDirsMeta) {
//       // IMPORTANT - only works while agent build dir name is equal to build ID
//       // but this is important as it speeds up the search a lot - don't have to
//       // read all the info files to get IDs
//       const agentBuildDirsMeta = getAgentBuildDirsMeta(agentDirPath)

//       // fail silently by returning undefined if any kind of issue
//       if (agentDirsMeta === undefined) {
//         return
//       }

//       for (let {
//         name: candidateBuildId,
//         path: agentBuildDirPath,
//       } of agentBuildDirsMeta) {
//         if (candidateBuildId === buildId) {
//           return { agentName, agentBuildDirPath }
//         }
//       }
//     }
//   } catch {
//     // fail silently by returning undefined if any kind of issue
//     return
//   }
// }

// // IMPORTANT
// //
// // To make logs command easier to use, only pass the build id to it
// // this means we have to search through all agents logs files to find it
// //
// // This could be slow when history is very large, as lots of files will have to be read,
// // so may have to introduce agent name as an option later to speed this up if it becomes an issue
// const logsCommandLogs = ({
//   buildId,
// }: {
//   buildId: string
// }): string | undefined => {
//   const agentBuild = findAgentBuild({ buildId })

//   if (agentBuild !== undefined) {
//     return `${agentBuild?.agentBuildDirPath}/${filenameUtils.logsFile({ buildId })}` // prettier-ignore
//   }
// }

// const logsCommandEvents = ({
//   buildId,
// }: {
//   buildId: string
// }): string | undefined => {
//   const agentBuild = findAgentBuild({ buildId })

//   if (agentBuild !== undefined) {
//     return `${agentBuild?.agentBuildDirPath}/${filenameUtils.eventsFile({ buildId })}` // prettier-ignore
//   }
// }

// export const cleanHistoryCommandValidateArgs = ({
//   agent,
//   build,
//   options,
// }: {
//   agent: string | undefined
//   build: string | undefined
//   options: { dryRun: boolean; reset: boolean }
// }): CleanHistoryCommandArgs => {
//   const validationErrors = []

//   if (agent !== undefined) {
//     agent = agent + '' // convert to string

//     if (agent.length > 32) {
//       validationErrors.push(`  - ${Yellow('agent name')} (1st argument) cannot be longer than 32 characters`) // prettier-ignore
//     }
//   }

//   if (build !== undefined) {
//     build = build + '' // convert to string

//     if (build.charAt(0) !== 'B' || build.length !== 12) {
//       validationErrors.push(`  - ${Yellow('build ID')} (2nd argument) must be 12 characters long and start with B`) // prettier-ignore
//     }
//   }

//   // only allow --reset option when an agent and build aren't specified
//   if (options.reset) {
//     if (agent !== undefined) {
//       validationErrors.push(`  - ${Yellow('hard')} option only applicable for cleaning entire history, not that of a specific ${build === undefined ? 'agent': 'build'}`) // prettier-ignore
//     }
//   }

//   if (validationErrors.length > 0) {
//     printErrorAndExit(validationErrors.join('\n'))
//   }

//   return {
//     dryRun: !!options.dryRun,
//     hardDelete: !!options.reset,
//     ...(agent !== undefined && { agentName: agent }),
//     ...(build !== undefined && { buildId: build }),
//   }
// }

// const cleanHistoryFull = ({
//   hardDelete,
//   dryRun,
// }: {
//   hardDelete: boolean
//   dryRun: boolean
// }): History | undefined =>
//   dryRun ? readHistory() : cleanHistory({ hardDelete })

// const cleanHistoryAgent = ({
//   agentName,
//   dryRun,
// }: {
//   agentName: string
//   dryRun: boolean
// }): AgentHistory | undefined =>
//   dryRun ? readAgentHistory({ agentName }) : cleanAgentHistory({ agentName })

// const cleanHistoryBuild = ({
//   agentName,
//   buildId,
//   dryRun,
// }: {
//   agentName: string
//   buildId: string
//   dryRun: boolean
// }): BuildHistory | undefined =>
//   dryRun
//     ? readBuildHistory({ agentName, buildId })
//     : cleanBuildHistory({ agentName, buildId })

// export default {
//   validateArgs,
//   fullHistory,
//   agentHistory,

//   // the logs command is actually under 'logs' in the CLI, not 'history', but the functionality is very similar
//   // so makes sense to keep them all in this one file
//   logsCommand: {
//     logs: logsCommandLogs,
//     events: logsCommandEvents,
//   },

//   // the clean command is actually under 'clean' in the CLI, not 'history', but the functionality is very similar
//   // so makes sense to keep them all in this one file
//   cleanHistory: {
//     validateArgs: cleanHistoryCommandValidateArgs,
//     full: cleanHistoryFull,
//     agent: cleanHistoryAgent,
//     build: cleanHistoryBuild,
//   },
// }
