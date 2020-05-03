import { getBoxCiDir, paths, filenameUtils } from './data'

// prettier-ignore
export default {
  logs: ({ buildId }: { buildId: string }): string =>
    `${paths.buildLogsDir(getBoxCiDir(), buildId)}/${filenameUtils.logsFile({ buildId })}`,

  events: ({ buildId }: { buildId: string }): string =>
    `${paths.buildLogsDir(getBoxCiDir(), buildId)}/${filenameUtils.eventsFile({ buildId })}`,
}
