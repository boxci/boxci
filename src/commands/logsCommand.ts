import { getBoxCiDir, paths, filenameUtils } from '../data'
import { Command } from 'commander'

// prettier-ignore
const logs = ({ buildId }: { buildId: string }): string =>
  `${paths.buildLogsDir(getBoxCiDir({ silent: false }), buildId)}/${filenameUtils.logsFile({ buildId })}`

// prettier-ignore
const events = ({ buildId }: { buildId: string }): string =>
  `${paths.buildLogsDir(getBoxCiDir({ silent: false }), buildId)}/${filenameUtils.eventsFile({ buildId })}`

export default ({ cli }: { cli: Command }) => {
  cli
    .command('logs <buildId>')

    // optional options
    .option('-e, --events')

    .action((buildId: string, options: { events: boolean }) => {
      const logsCommandString = !!options.events
        ? events({ buildId })
        : logs({ buildId })

      if (logsCommandString === undefined) {
        return
      }

      process.stdout.write(logsCommandString)
    })
}
