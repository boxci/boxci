import { readHistory, History, AgentHistory } from './data'
import { Bright, Yellow } from './consoleFonts'

const formattedStartTime = (startTime: number): string => {
  const isoString = new Date(startTime).toISOString()

  const date = isoString.substring(0, 10)
  const time = isoString.substring(12, 19)

  return `${date} @ ${time}`
}

// prettier-ignore
const printAgentHistory = (agentHistory: AgentHistory): string => {
  let output = `∙ ${Bright(agentHistory.info.agentName)}\n`
  output +=    `  ${Yellow('Project')}  ${agentHistory.info.project}\n`
  output +=    `  ${Yellow('Started')}  ${formattedStartTime(agentHistory.info.startTime)}\n`
  output +=    `  ${Yellow('Builds')}   ${agentHistory.buildIds.length}\n`
  output +=    '\n'

  return output
}

const print = (
  limit: number,
): {
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

export default {
  print,
}
