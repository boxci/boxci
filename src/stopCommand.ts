import { Yellow } from './consoleFonts'
import { printErrorAndExit } from './logging'
import { stopAgent } from './data2'

type StopCommandArgs = {
  agentName: string
}

const validateArgs = ({
  agent,
}: {
  agent: string | undefined
}): StopCommandArgs => {
  const validationErrors: Array<string> = []

  if (agent === undefined) {
    printErrorAndExit(`You must provide the name of the agent to stop as the first argument\n\n  e.g. ${Yellow('boxci stop agent-a12-b34-c56-d78')}\n`) // prettier-ignore

    return undefined as never
  } else {
    agent = agent + '' // convert to string

    if (agent.length > 32) {
      validationErrors.push(`  - ${Yellow('agent name')} cannot be longer than 32 characters`) // prettier-ignore
    }
  }

  if (validationErrors.length > 0) {
    printErrorAndExit(validationErrors.join('\n'))
  }

  return {
    agentName: agent,
  }
}

const stop = ({ agentName }: { agentName: string }) => {
  stopAgent({ agentName })
}

export default {
  validateArgs,
  stop,
}
