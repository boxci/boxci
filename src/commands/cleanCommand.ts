import { getAgents, deleteAgentRepo } from '../data'
import { Command } from 'commander'
import { Bright, Red } from '../consoleFonts'

export default ({
  cli,
  commandMatched,
}: {
  cli: Command
  commandMatched: () => void
}) => {
  cli.command('clean').action(() => {
    commandMatched()

    const { expiredAgents, stoppedAgents } = getAgents({
      agentConfig: { silent: false },
    })

    let cleanedAgents: string[] = []
    let errors: string[] = []

    for (let agentName of expiredAgents) {
      const result = deleteAgentRepo({
        agentConfig: { silent: false },
        agentName,
      })

      if (result.code === 'deleted') {
        cleanedAgents.push(agentName)
      }
    }

    // these should all already be cleaned, but just to make sure
    for (let agentName of stoppedAgents) {
      const result = deleteAgentRepo({
        agentConfig: { silent: false },
        agentName,
      })

      if (result.code === 'deleted') {
        cleanedAgents.push(agentName)
      } else if (result.code === 'error') {
        errors.push(agentName)
      }
    }

    let message = ''

    if (cleanedAgents.length === 0) {
      message += `\n${Bright('All agents already cleaned')}`
    } else {
      message += `\n${Bright(`Cleaned ${cleanedAgents.length} agents`)}` // prettier-ignore
    }

    if (errors.length > 0) {
      message += '\n'
      // prettier-ignore
      message += `${Red('WARNING:')} ${errors.length} other agents could not be cleaned because of errors,\nYou may have to delete their directories manually:\n`
      errors.forEach((error) => {
        message += `\n  - ${error}`
      })
    }

    message += '\n'

    console.log(message)
  })
}
