import { Bright } from './consoleFonts'

export type LogLevel = 'INFO' | 'DEBUG' | 'TRACE'

const VERSION: string = process.env.NPM_VERSION as string

export const commandFirstLine = (type?: string) =>
  `${Bright(`Box CI` + (type ? ` ${type}` : ''))}     v${VERSION}`

const LOGGING_ENABLED =
  process.env.NODE_ENV === 'development' || !!process.env.BOXCI_LOG_LEVEL
const DEFAULT_LOG_LEVEL = 'INFO'

const getCurrentLogLevel = (): LogLevel => {
  const candidate: string | undefined = process.env.BOXCI_LOG_LEVEL

  if (!candidate) {
    return DEFAULT_LOG_LEVEL
  }

  if (candidate !== 'INFO' && candidate !== 'DEBUG') {
    console.error(
      `ERROR: environment variable $BOXCI_LOG_LEVEL is set as '${candidate}'` +
        `It must be one of { INFO, DEBUG }. Defaulting to '${DEFAULT_LOG_LEVEL}'`,
    )

    return DEFAULT_LOG_LEVEL
  }

  if (candidate === 'INFO') {
    console.log(`\nLog level set to INFO\n`)
  }

  if (candidate === 'DEBUG') {
    console.log(`\nLog level set to DEBUG\n`)
  }

  return candidate
}

export const CONFIGURED_LOG_LEVEL: LogLevel = getCurrentLogLevel()

const isAtLogLevel = (logLevel: LogLevel): boolean => {
  switch (CONFIGURED_LOG_LEVEL) {
    case 'INFO':
      return logLevel === 'INFO'

    case 'DEBUG':
      return logLevel === 'DEBUG' || logLevel == 'INFO'

    case 'TRACE':
      return true // log everything in TRACE mode - this logs lots of detail like all requests/responses so may be a bit much even for debugging

    default: {
      const typsecriptWillThrowAnErrorHereIfThereIsAnUnmatchedCase: never = CONFIGURED_LOG_LEVEL

      return true // will never happen
    }
  }
}

export const log = (logLevel: LogLevel, message: () => string) => {
  if (LOGGING_ENABLED && isAtLogLevel(logLevel)) {
    console.log(`${logLevel}: ${message()}`)
  }
}
