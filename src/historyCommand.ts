import {
  readHistory,
  History,
  AgentHistory,
  readAgentHistory,
  BuildHistory,
  getAgentDirsMeta,
  getAgentBuildDirsMeta,
  filenameUtils,
  cleanHistory,
} from './data'
import { Bright, Yellow, LightBlue } from './consoleFonts'
import { printErrorAndExit } from './logging'

export type HistoryCommandArgs = {
  last: number
  agentName?: string
}

export type CleanHistoryCommandArgs = {
  dryRun: boolean
  agentName?: string
}

const HISTORY_COMMAND_LAST_OPTION_DEFAULT = '10'

const validateArgs = ({
  agent,
  options,
}: {
  agent: string | undefined
  options: { last: string }
}): HistoryCommandArgs => {
  const validationErrors = []

  let last: number = 0

  try {
    last = parseInt(options.last ?? HISTORY_COMMAND_LAST_OPTION_DEFAULT)

    if (last < 1) {
      validationErrors.push(`  - ${Yellow('--last (-l)')} must be a positive integer`) // prettier-ignore
    }
  } catch (err) {
    validationErrors.push(`  - ${Yellow('--last (-l)')} must be a positive integer`) // prettier-ignore
  }

  if (agent !== undefined) {
    agent = agent + '' // convert to string

    if (agent.length > 32) {
      validationErrors.push(`  - ${Yellow('agent name')} (1st argument) cannot be longer than 32 characters`) // prettier-ignore
    }
  }

  if (validationErrors.length > 0) {
    printErrorAndExit(validationErrors.join('\n'))
  }

  return {
    last,
    ...(agent !== undefined && { agentName: agent }),
  }
}

const formattedStartTime = (startTime: number): string => {
  const isoString = new Date(startTime).toISOString()

  const date = isoString.substring(0, 10)
  const time = isoString.substring(12, 19)

  return `${date} @ ${time}`
}

// prettier-ignore
const printAgentHistory = (agentHistory: AgentHistory): string => {
  const projectLink = `https://boxci.dev/p/${agentHistory.info.project}`

  let output = `│ ${Bright(agentHistory.info.agentName)}\n`
  output +=    `│\n`
  output +=    `│ Project    ${LightBlue(projectLink)}\n`
  output +=    `│ Started    ${formattedStartTime(agentHistory.info.startTime)}\n`
  output +=    `│ Builds     ${agentHistory.numberOfBuilds}\n`
  output +=    `│ History    ${Yellow(`boxci history ${agentHistory.info.agentName}`)}\n`
  output +=    '\n'

  return output
}

// prettier-ignore
const printBuildHistory = ({agentHistory, buildHistory }:{ agentHistory: AgentHistory, buildHistory: BuildHistory }): string => {
  const buildLink = `https://boxci.dev/p/${agentHistory.info.project}/${buildHistory.info.id}`

  let output = `│ ${Bright(`Build ${buildHistory.info.id}`)}\n`
  output +=    `│\n`
  output +=    `│ Started   ${formattedStartTime(buildHistory.info.startTime)}\n`
  output +=    `│ Link      ${LightBlue(buildLink)}\n`
  output +=    `│ Logs      cat $(${Yellow(`boxci logs ${buildHistory.info.id}`)})\n`
  output +=    '\n'

  return output
}

const fullHistory = ({
  limit,
}: {
  limit: number
}): {
  history: History
  output: string
} => {
  const history = readHistory()

  let output = ''

  history.agents.slice(0, limit).forEach((agentHistory) => {
    output += printAgentHistory(agentHistory)
  })

  return {
    history,
    output,
  }
}

const agentHistory = ({
  limit,
  agentName,
}: {
  limit: number
  agentName: string
}): {
  agentHistory: AgentHistory
  output: string
} => {
  const agentHistory = readAgentHistory({ agentName })

  // if undefined, the agent history does not exist
  if (agentHistory === undefined) {
    printErrorAndExit(
      `No history found for ${Bright(agentName)}\n\n` +
        `The agent name may be incorrect, or its history may have been deleted.`,
    )

    return undefined as never
  }

  let output = ''

  agentHistory.builds?.slice(0, limit).forEach((buildHistory) => {
    output += printBuildHistory({ agentHistory, buildHistory })
  })

  return {
    agentHistory,
    output,
  }
}

const FAIL_SILENTLY = true

// IMPORTANT - only works while agent build dir name is equal to build ID
// but this is important as it speeds up the search a lot - don't have to
// read all the info files to get IDs
const findAgentBuild = ({
  buildId,
}: {
  buildId: string
}): { agentName: string; agentBuildDirPath: string } | undefined => {
  try {
    const agentDirsMeta = getAgentDirsMeta(FAIL_SILENTLY)

    // fail silently by returning undefined if any kind of issue
    if (agentDirsMeta === undefined) {
      return
    }

    // iterate through until the path for the build's directory is found
    for (let { name: agentName, path: agentDirPath } of agentDirsMeta) {
      // IMPORTANT - only works while agent build dir name is equal to build ID
      // but this is important as it speeds up the search a lot - don't have to
      // read all the info files to get IDs
      const agentBuildDirsMeta = getAgentBuildDirsMeta(agentDirPath)

      // fail silently by returning undefined if any kind of issue
      if (agentDirsMeta === undefined) {
        return
      }

      for (let {
        name: candidateBuildId,
        path: agentBuildDirPath,
      } of agentBuildDirsMeta) {
        if (candidateBuildId === buildId) {
          return { agentName, agentBuildDirPath }
        }
      }
    }
  } catch {
    // fail silently by returning undefined if any kind of issue
    return
  }
}

// IMPORTANT
//
// To make logs command easier to use, only pass the build id to it
// this means we have to search through all agents logs files to find it
//
// This could be slow when history is very large, as lots of files will have to be read,
// so may have to introduce agent name as an option later to speed this up if it becomes an issue
const logsCommandLogs = ({
  buildId,
}: {
  buildId: string
}): string | undefined => {
  const agentBuild = findAgentBuild({ buildId })

  if (agentBuild !== undefined) {
    return `${agentBuild?.agentBuildDirPath}/${filenameUtils.logsFile({ buildId })}` // prettier-ignore
  }
}

const logsCommandEvents = ({
  buildId,
}: {
  buildId: string
}): string | undefined => {
  const agentBuild = findAgentBuild({ buildId })

  if (agentBuild !== undefined) {
    return `${agentBuild?.agentBuildDirPath}/${filenameUtils.eventsFile({ buildId })}` // prettier-ignore
  }
}

const cleanHistoryCommandValidateArgs = ({
  agent,
  options,
}: {
  agent: string | undefined
  options: { dryRun: boolean }
}): CleanHistoryCommandArgs => {
  const validationErrors = []

  if (agent !== undefined) {
    agent = agent + '' // convert to string

    if (agent.length > 32) {
      validationErrors.push(`  - ${Yellow('agent name')} (1st argument) cannot be longer than 32 characters`) // prettier-ignore
    }
  }

  if (validationErrors.length > 0) {
    printErrorAndExit(validationErrors.join('\n'))
  }

  return {
    dryRun: !!options.dryRun,
    ...(agent !== undefined && { agentName: agent }),
  }
}

const cleanFullHistory = ({
  dryRun,
}: {
  dryRun: boolean
}): History | undefined => (dryRun ? readHistory() : cleanHistory())

const cleanAgentHistory = ({
  agentName,
  dryRun,
}: {
  agentName: string
  dryRun: boolean
}) => (dryRun ? readHistory() : cleanHistory())

export default {
  validateArgs,
  fullHistory,
  agentHistory,

  // the logs command is actually under 'logs' in the CLI, not 'history', but the functionality is very similar
  // so makes sense to keep them all in this one file
  logsCommand: {
    logs: logsCommandLogs,
    events: logsCommandEvents,
  },

  // the clean command is actually under 'clean' in the CLI, not 'history', but the functionality is very similar
  // so makes sense to keep them all in this one file
  cleanHistory: {
    validateArgs: {},
    full: cleanFullHistory,
    agent: cleanAgentHistory,
  },
}
