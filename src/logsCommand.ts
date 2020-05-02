import { getBoxCiDir, paths, filenameUtils } from './data2'

// prettier-ignore
export default {
  logs: ({ buildId }: { buildId: string }): string =>
    `${paths.buildLogsDir(getBoxCiDir(), buildId)}/${filenameUtils.logsFile({ buildId })}`,

  events: ({ buildId }: { buildId: string }): string =>
    `${paths.buildLogsDir(getBoxCiDir(), buildId)}/${filenameUtils.eventsFile({ buildId })}`,
}
