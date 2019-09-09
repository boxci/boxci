import { Command } from 'commander'
import CommandLogger from './CommandLogger'
import { buildApi } from './api'
import { log } from './logging'
import ListMessagePrinter from './ListMessagePrinter'
import getConfig from './config'
import { getCurrentTimeStamp } from './util'
import {
  OPTIONAL_OPTIONS_PLACEHOLDER,
  ADVANCED_OPTIONS_PLACEHOLDER,
  END_PLACEHOLDER,
  customHelpMessage,
} from './help'

const VERSION: string = process.env.NPM_VERSION as string
const cli = new Command()

const collectLabels = (curr: string, acc: Array<string>): Array<string> => [
  ...acc,
  curr,
]

// prettier-ignore
cli
  .version(VERSION)

  // required options
  .option('-p, --project <arg>', "Project ID (find on the project page on boxci.dev)")
  .option('-k, --key <arg>', `Project access key (find on the project page on boxci.dev)${OPTIONAL_OPTIONS_PLACEHOLDER}`)

  // optional options
  .option('-l, --label <arg>', `Add a label to this build run. Syntax: key,value. For multiple labels, repeat the option`, collectLabels, [])
  .option('-s, --silent', 'Do not display build command output', false)
  .option('-ne, --no-emojis', `No emojis in boxci messaging. Does not affect build command output`)
  .option('-ns, --no-spinners', `No spinners in boxci messaging. Does not affect build command output${ADVANCED_OPTIONS_PLACEHOLDER}`)

  // advanced options
  .option('-r, --retries <arg>', "Max retries for requests to the service. Range 0-100. Default 10", 10)
  .option('-sv, --service <arg>', `Service URL. Only use if you are using your own service implementation instead of Box CI${END_PLACEHOLDER}`, 'https://boxci.dev/a-p-i/cli')

  .arguments('<commandString>')
  .action(async (commandString: string) => {
    // sets shelljs current working directory to where the cli is run from,
    // instead of the directory where the cli script is
    const cwd = process.cwd()

    const buildStart = getCurrentTimeStamp()

    const config = getConfig(cli, cwd)
    const api = buildApi(config)
    const listMessagePrinter = new ListMessagePrinter(config)

    // prettier-ignore
    log('INFO', () => `CLI config options:\n\n${JSON.stringify(config, null, 2)}\n\n`)

    // start the build by requesting a build run id from the service
    listMessagePrinter.printTitle('build running')
    listMessagePrinter.printListItem(`Project id: ${config.projectId}`)
    listMessagePrinter.printListItem(`Build command: ${commandString}`)
    const startBuildStart = getCurrentTimeStamp()
    const startBuildSpinner = listMessagePrinter.printListItemSpinner(
      'Initializing build...',
    )

    try {
      const { projectBuildId } = await api.start({
        commandString,
        labels: config.labels
      })

      startBuildSpinner.finish(
        `Build initialized (took ${getCurrentTimeStamp() - startBuildStart}ms)`,
      )
      listMessagePrinter.printListItem(`Build id: ${projectBuildId}`)

      // run the command and send logs to the service
      let runBuildSpinner

      if (config.silent) {
        runBuildSpinner = listMessagePrinter.printListItemSpinner(
          'Running build command...',
        )
      } else {
        console.log('') // print newline before build output is printed
      }

      const commandLogger = new CommandLogger(
        config,
        projectBuildId,
        commandString,
        api,
        cwd,
      )
      const { runtimeMs } = await commandLogger.whenCommandFinished()
      const buildCompleteMessage = `Build command finished (took ${runtimeMs}ms)`
      if (runBuildSpinner) {
        runBuildSpinner.finish(buildCompleteMessage)
      } else {
        listMessagePrinter.printTitle(buildCompleteMessage)
      }
      const finishSendingLogsSpinner = listMessagePrinter.printListItemSpinner(
        'Sending logs...',
      )

      const finishSendingLogsStart = getCurrentTimeStamp()
      const allLogsSentResult = await commandLogger.whenAllLogsSent()

      if (!allLogsSentResult.errors) {
        // prettier-ignore
        finishSendingLogsSpinner.finish(`All logs sent (took an additional ${getCurrentTimeStamp() - finishSendingLogsStart}ms)`)
        // prettier-ignore
        listMessagePrinter.printListItem(`Finished build (total time ${getCurrentTimeStamp() - buildStart}ms)\n`)
      } else {
        const numberOfErrors =
          allLogsSentResult.sendChunkErrors!.length +
          (allLogsSentResult.doneEventError ? 1 : 0)
        finishSendingLogsSpinner.finish(
          `Failed to send all logs - ${numberOfErrors} failed requests:\n\n`,
        )
        let errorCount = 1
        if (allLogsSentResult.doneEventError) {
          // prettier-ignore
          console.log(`[${errorCount++}]  The 'done' event failed to send, cause:\n    ${errorCount < 10 ? ' ' : ''}- ${allLogsSentResult.doneEventError}\n`)
        }
        // exit process with error code
        for (let error of allLogsSentResult.sendChunkErrors!) {
          // prettier-ignore
          console.log(`[${errorCount++}]  Error sending a log chunk, cause:\n    ${errorCount < 10 ? ' ' : ''}- ${error}\n`)
        }

        process.exit(1)
      }
    } catch (errGettingRunId) {
      // log reason for error in spinner
      startBuildSpinner.finish(
        `Failed to start build - could not communicate with service.\n\nCause:\n\n${errGettingRunId}\n\n`,
      )

      // exit process with error code
      process.exit(1)
    }
  });

const displayCustomHelpMessage = () => {
  cli.help(customHelpMessage)
}

// override -h, --help default behaviour from commanderjs
// use the custokm help messaging defined in ./help.ts
if (
  process.argv.indexOf('-h') !== -1 ||
  process.argv.indexOf('--help') !== -1
) {
  displayCustomHelpMessage()
}

cli.parse(process.argv)

// if no args passed, display customer help message
if (cli.args.length === 0) {
  displayCustomHelpMessage()
}
