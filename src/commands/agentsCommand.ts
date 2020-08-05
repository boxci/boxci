import { getRunningAgents } from '../data'
import { Command } from 'commander'
import { Bright } from '../consoleFonts'

export default ({
  cli,
  commandMatched,
}: {
  cli: Command
  commandMatched: () => void
}) => {
  cli.command('agents').action(() => {
    commandMatched()

    const runningAgents = getRunningAgents({
      agentConfig: { silent: false },
    })

    let message = ''

    if (runningAgents.length === 0) {
      message += `\n${Bright('No Box CI agents are running')}`
    } else {
      message += `\n${Bright(
        `${runningAgents.length} Box CI agents are running:\n`,
      )}`

      runningAgents.forEach((agentId) => {
        message += `\n  - ${agentId}`
      })
    }

    message += '\n'

    console.log(message)
  })
}
