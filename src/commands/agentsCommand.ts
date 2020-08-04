import { getActiveAgents } from '../data'
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

    const activeAgents = getActiveAgents()

    let message = `\n${Bright('Box CI Agents')}: `

    if (activeAgents.length === 0) {
      message += 'None Active'
    } else {
      message += `${activeAgents.length} Active\n`

      activeAgents.forEach((agentId: string) => {
        message += `\n  ${agentId}`
      })
    }

    message += '\n'

    console.log(message)
  })
}
