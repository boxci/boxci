import { Command } from 'commander'
import agentCommand from './commands/agentCommand'
import cleanLogsCommand from './commands/cleanLogsCommand'
import historyCommand from './commands/historyCommand'
import logsCommand from './commands/logsCommand'
import stopCommand from './commands/stopCommand'
import help from './help'

const version: string = process.env.NPM_VERSION as string
const cli = new Command()

cli.version(version)

agentCommand({ cli, version }) //   boxci agent
stopCommand({ cli }) //             boxci stop [agent]
historyCommand({ cli }) //          boxci history ['build' | 'project' | 'all'] [id]
cleanLogsCommand({ cli }) //        boxci clean-logs
logsCommand({ cli }) //             boxci logs <build>

// override -h, --help default behaviour from commanderjs
if (
  process.argv.indexOf('-h') !== -1 ||
  process.argv.indexOf('--help') !== -1
) {
  cli.help(help.print)
}

cli.parse(process.argv)

// if no args passed, display help message
if (cli.args.length === 0) {
  cli.help(help.print)
}
