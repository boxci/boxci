import {
  readHistory,
  History,
  AgentHistory,
  readAgentHistory,
  BuildHistory,
} from './data'
import { Bright, Yellow, LightBlue } from './consoleFonts'
import { printErrorAndExit } from './logging'

export type HistoryCommandArgs = {
  last: number
  agentName?: string
}

const HISTORY_COMMAND_LAST_OPTION_DEFAULT = 10

const parseArgs = ({
  options,
}: {
  options: { [key: string]: string }
}): HistoryCommandArgs => {
  // convert from string to number if the option is passed
  // @ts-ignore
  let last: number = options.last ?? HISTORY_COMMAND_LAST_OPTION_DEFAULT
  let agentName = options.agent

  const validationErrors = []

  try {
    // convert from string to number if the option is passed
    // @ts-ignore
    last = parseInt(last)

    if (last < 1) {
      validationErrors.push(`  - ${Yellow('last')} must be a positive integer`) // prettier-ignore
    }
  } catch (err) {
    validationErrors.push(`  - ${Yellow('last')} must be a positive integer`) // prettier-ignore
  }

  if (agentName !== undefined) {
    agentName = agentName + '' // convert to string

    if (agentName.length > 32) {
      validationErrors.push(`  - ${Yellow('agent')} cannot be longer than 32 characters`) // prettier-ignore
    }
  }

  if (validationErrors.length > 0) {
    printErrorAndExit(validationErrors.join('\n'))
  }

  return {
    last,
    ...(agentName !== undefined && { agentName }),
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

  let output = `∙ ${Bright(agentHistory.info.agentName)}\n`
  output +=    `  ${Yellow('Project')}  ${LightBlue(projectLink)}\n`
  output +=    `  ${Yellow('Started')}  ${formattedStartTime(agentHistory.info.startTime)}\n`
  output +=    `  ${Yellow('Builds')}   ${agentHistory.builds.length}\n`
  output +=    '\n'

  return output
}

// prettier-ignore
const printBuildHistory = (agentHistory: AgentHistory, buildHistory: BuildHistory): string => {
  const buildLink = `https://boxci.dev/p/${agentHistory.info.project}/${buildHistory.id}`

  // this should never happen - we should never be printing the partial build history
  // where we didn't read the build info files
  // (this is only the case in the full history and we don't print build history there)
  //
  // but in case it does happen, throw an error
  if (buildHistory.info === undefined) {
    printErrorAndExit(`Cannot show build history for build ${Bright(buildHistory.id)}, agent ${Bright(agentHistory.info.agentName)} - build info not present`)

    return undefined as never
  }

  let output = `∙ ${Bright(`Build ${buildHistory.id}`)}\n`
  output +=    `  ${Yellow('Link')}     ${LightBlue(buildLink)}\n`
  output +=    `  ${Yellow('Started')}  ${formattedStartTime(buildHistory.info.startTime)}\n`
  output +=    `  ${Yellow('Result')}   ${buildHistory.info.result ?? 'unfinished'}\n`
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

  agentHistory.builds.slice(0, limit).forEach((buildHistory) => {
    output += printBuildHistory(agentHistory, buildHistory)
  })

  return {
    agentHistory,
    output,
  }
}

export default {
  parseArgs,
  fullHistory,
  agentHistory,
}
