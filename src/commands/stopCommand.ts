import { Yellow, Bright } from '../consoleFonts'
import { printErrorAndExit, formattedTime } from '../logging'
import { Command } from 'commander'
import { stopAgent } from '../data'

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
    printErrorAndExit({ silent: false }, `You must provide the name of the agent to stop as the first argument\n\n  e.g. ${Yellow('boxci stop agent-a12-b34-c56-d78')}\n`) // prettier-ignore

    return undefined as never
  } else {
    agent = agent + '' // convert to string

    if (agent.length > 32) {
      validationErrors.push(`  - ${Yellow('agent name')} cannot be longer than 32 characters`) // prettier-ignore
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
  })
}
