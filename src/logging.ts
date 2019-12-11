import { Bright, Red, Underline, Yellow, LightBlue } from './consoleFonts'
import fs from 'fs'
import { Spinner } from './Spinner'

export type LogLevel = 'ERROR' | 'INFO' | 'DEBUG' | 'TRACE'

const VERSION: string = process.env.NPM_VERSION as string

export const printErrorAndExit = (
  message: string,
  spinner?: Spinner,
  logFilePath?: string,
) => {
  if (spinner) {
    spinner.stop()
  }

  console.log(
    `\n${Bright(Red(Underline(`Error`)))}\n\n` +
      `${message}\n\n` +
      (logFilePath ? `See log file at ${LightBlue(logFilePath)}\n\n` : '') +
      `Run ${Yellow('boxci --help')} for documentation\n\n`,
  )

  process.exit(1)

  return undefined as never
}

export const commandFirstLine = (type?: string) =>
  `${Bright(`Box CI` + (type ? ` ${type}` : ''))}     v${VERSION}`

const LINE_BREAK = '\n'

export class LogFile {
  private filestream: fs.WriteStream
  public logLevel: LogLevel
  public filePath: string

  constructor(filePath: string, logLevel: LogLevel, spinner: Spinner) {
    try {
      this.filePath = filePath
      this.logLevel = logLevel
      this.filestream = fs.createWriteStream(filePath, {
        flags: 'a',
        encoding: 'utf-8',
      })
    } catch (err) {
      const never = printErrorAndExit(
        `Could not create log file ${filePath}`,
        spinner,
        filePath,
      )

      // to stop typescript thinking these might be possibly undefined
      this.filePath = never
      this.filestream = never
      this.logLevel = never
    }
  }

  public write(logLevel: LogLevel, str: string) {
    if (this.isAtLogLevel(logLevel)) {
      this.filestream.write(str + LINE_BREAK)
    }
  }

  public writeLine(logLevel: LogLevel, str: string) {
    this.write(logLevel, logLevel + ' - ' + str + LINE_BREAK)
  }

  public close() {
    this.filestream.end()
  }

  private isAtLogLevel(logLevel: LogLevel): boolean {
    switch (this.logLevel) {
      case 'ERROR':
        return logLevel === 'ERROR'
      case 'INFO':
        return logLevel === 'INFO' || logLevel === 'ERROR'
      case 'DEBUG':
        return (
          logLevel === 'DEBUG' || logLevel == 'INFO' || logLevel === 'ERROR'
        )
      case 'TRACE':
        return true // log everything in TRACE mode
      default: {
        // TypeScript errors here if there is an unmatched case
        const errorIfUnmatchedCase: never = this.logLevel

        return errorIfUnmatchedCase
      }
    }
  }
}
