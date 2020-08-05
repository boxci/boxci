import { Command } from 'commander'
import agentCommand from './commands/agentCommand'
import agentsCommand from './commands/agentsCommand'
import cleanLogsCommand from './commands/cleanLogsCommand'
import historyCommand from './commands/historyCommand'
import logsCommand from './commands/logsCommand'
import stopCommand from './commands/stopCommand'
import help from './help'
import { Yellow } from './consoleFonts'
import cleanCommand from './commands/cleanCommand'

// prettier-ignore
const HELP_ALIASES = '-h --h h -help --help help'.split(' ')
// prettier-ignore
const VERSION_ALIASES = '-v --v v -version --version version -ver --ver ver'.split(' ')

const caseInsensitiveAliasMatch = (candidate: string, alisases: string[]) =>
  !!alisases.find((alias) => candidate.toLowerCase() === alias)

const version: string = process.env.NPM_VERSION as string
const cli = new Command()

cli.version(version)

// passed as a function too all commands and fired if command runs,
// so we can tell whcih command was matched in an easy way
let _commandMatched
const commandMatched = (command: string) => () => {
  _commandMatched = command
}

agentCommand({ cli, commandMatched: commandMatched('agent'), version }) //    boxci agent
agentsCommand({ cli, commandMatched: commandMatched('agent') }) //            boxci agents
stopCommand({ cli, commandMatched: commandMatched('stop') }) //               boxci stop [agent]
historyCommand({ cli, commandMatched: commandMatched('history') }) //         boxci history ['build' | 'project' | 'all'] [id]
cleanLogsCommand({ cli, commandMatched: commandMatched('clean-logs') }) //    boxci clean-logs
cleanCommand({ cli, commandMatched: commandMatched('clean') }) //             boxci clean
logsCommand({ cli, commandMatched: commandMatched('logs') }) //               boxci logs <build>

// if args don't match above args, there are a few options
// if zero args, or if one of help aliases passed, print help
// if one of version alisases passed, print version
//
// otherwise, let commanderjs do the arguments parsing
let handleWithCommanderJs = false
const zeroArgs = !process.argv || process.argv.length === 2
const exactlyOneArg = process.argv[2]
if (zeroArgs) {
  cli.help(help.print)
} else if (exactlyOneArg) {
  if (caseInsensitiveAliasMatch(exactlyOneArg, HELP_ALIASES)) {
    cli.help(help.print)
  } else if (caseInsensitiveAliasMatch(exactlyOneArg, VERSION_ALIASES)) {
    console.log(version)
  } else {
    // if no matches here, fall through to letting commanderjs do the processing
    handleWithCommanderJs = true
  }
} else {
  handleWithCommanderJs = true
}

if (handleWithCommanderJs) {
  cli.parse(process.argv)

  // if there was no match, show an error
  if (_commandMatched === undefined) {
    const printCommand =
      process.argv !== undefined && process.argv.length > 2
        ? process.argv.slice(2).join(' ')
        : ''

    let message = `\nboxci v${version}\n  Unknown command`

    if (printCommand) {
      message += ` ${Yellow(printCommand)}`
    }

    message += `\n  Run ${Yellow('boxci help')} to see available commands\n`

    console.log(message)
  }
}
