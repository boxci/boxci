import { Yellow, Bright } from '../consoleFonts'
import { printErrorAndExit, formattedTime } from '../logging'
import { Command } from 'commander'
import { stopAgent, stopAllRunningAgents, StopAgentOutput } from '../data'

type StopCommandArgs = {
  agentName: string
}

const validateArgs = ({
  agent,
}: {
  agent: string | undefined
}): StopCommandArgs => {
  const validationErrors: Array<string> = []

  if (!agent) {
    printErrorAndExit({ silent: false }, `1st argument must be either an agent name (e.g. ${Yellow('boxci stop agent-a12-b34-c56-d78')}) or ${Yellow('all')}\n`) // prettier-ignore

    return undefined as never
  } else {
    agent = agent + '' // convert to string
    agent = agent.trim()

    if (agent !== 'all') {
      if (
        !agent.startsWith('agent-') ||
        agent.length !== 'agent-a12-b34-c56-d78'.length
      ) {
        validationErrors.push(`  - agent name should match format ${Yellow('agent-a12-b34-c56-d78')}`) // prettier-ignore
      }
    }
  }

  if (validationErrors.length > 0) {
    printErrorAndExit({ silent: false }, validationErrors.join('\n'))
  }

  return {
    agentName: agent,
  }
}

export default ({
  cli,
  commandMatched,
}: {
  cli: Command
  commandMatched: () => void
}) => {
  cli.command('stop [agent]').action((agent: string | undefined) => {
    commandMatched()
    console.log('')

    const args = validateArgs({ agent })

    if (args.agentName === 'all') {
      const results = stopAllRunningAgents({
        agentConfig: { silent: false },
      })

      const stopped: StopAgentOutput[] = []
      const errors: StopAgentOutput[] = []

      results.forEach((result) => {
        if (result.code === 'success' || result.code === 'already-stopped') {
          stopped.push(result)
        } else if (result.code === 'error') {
          errors.push(result)
        }
      })

      let message =
        `Stopping ${Bright(`${stopped.length}`)} running agents\n\n` +
        `If the agent is currently running a build, that will complete first.\n\n`

      stopped.forEach((result) => {
        message += `\n  - ${result.agentName}`
      })

      if (errors.length > 0) {
        message += `\n\n${Bright(`${errors.length}`)} agents could not be stopped because of errors:\n\n` // prettier-ignore

        errors.forEach((result) => {
          message += `\n  - ${result.agentName}`
        })

        message += `\n\nTry stopping those agents individually with ${Yellow(`boxci stop <agent name>`)}` // prettier-ignore
      }

      message += '\n'

      console.log(message)
    } else {
      const result = stopAgent({
        agentConfig: { silent: false },
        agentName: args.agentName,
      })

      switch (result.code) {
        case 'success': {
          console.log(
            `Stopping ${Bright(args.agentName)}\n\n` +
              `If the agent is currently running a build, that will complete first.\n\n`,
          )
          return
        }

        case 'not-found': {
          console.log(`${Bright(args.agentName)} not found. Is the name correct?\n\n`) // prettier-ignore
          return
        }

        case 'already-stopped': {
          console.log(`${Bright(args.agentName)} already stopped (on ${formattedTime(result.detail.stoppedAt, 'at')})\n\n`) // prettier-ignore
          return
        }

        case 'error': {
          console.log(`Error stopping ${Bright(args.agentName)}.\n\nCause:\n\n${result.detail.err}\n\n`) // prettier-ignore
          return
        }

        default: {
          const x: never = result.code

          return x
        }
      }
    }
  })
}
