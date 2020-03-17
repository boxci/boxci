import fs from 'fs'
import { ProjectBuild } from './api'
import { padStringToLength, currentTimeStampString } from './util'

export type LogLevel = 'ERROR' | 'INFO' | 'DEBUG' | 'TRACE'

const createFile = (path: string) =>
  fs.createWriteStream(path, { flags: 'a', encoding: 'utf-8' })

export default class Logger {
  public dir: string
  public logLevel: LogLevel

  private logsFile: fs.WriteStream | undefined
  private eventsFile: fs.WriteStream | undefined

  private ready: boolean = false

  constructor(
    logsDirPath: string,
    projectBuild: ProjectBuild,
    logLevel: LogLevel,
  ) {
    this.dir = `${logsDirPath}/${projectBuild.id}`
    this.logLevel = logLevel

    try {
      fs.mkdirSync(this.dir)
      this.logsFile = createFile(`${this.dir}/logs.txt`)
      this.eventsFile = createFile(`${this.dir}/events.txt`)

      this.ready = true
    } catch (err) {
      // ignore, just don't set this.ready true - caller will handle this
    }
  }

  public isReady(): boolean {
    return this.ready
  }

  public writeLogs(str: string) {
    this.logsFile?.write(str)
  }

  public writeEvent(logLevel: LogLevel, str: string) {
    if (this.isAtLogLevel(logLevel)) {
      this.eventsFile?.write(`${padStringToLength(logLevel, 5)} | ${currentTimeStampString()} ==> ${str}\n`) // prettier-ignore
    }
  }

  public writeError(str: string, err: Error) {
    this.writeEvent('ERROR', `${str}\n\n${err}`)
  }

  public close() {
    this.logsFile?.end()
    this.eventsFile?.end()
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
