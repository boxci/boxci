import fs from 'fs'
import { ProjectBuild, ProjectBuildTask } from './api'
import { padStringToLength, currentTimeStampString } from './util'
import { filenameUtils } from './data2'

export type LogLevel = 'ERROR' | 'INFO' | 'DEBUG' | 'TRACE'

const createFile = (path: string) =>
  fs.createWriteStream(path, { flags: 'a', encoding: 'utf-8' })

export default class BuildLogger {
  public logLevel: LogLevel

  private logsFile: fs.WriteStream | undefined
  private eventsFile: fs.WriteStream | undefined

  private ready: boolean = false

  private errorHappenedOnWrite: boolean = false

  constructor({
    projectBuild,
    buildLogsDir,
    logLevel,
  }: {
    projectBuild: ProjectBuild
    buildLogsDir: string
    logLevel: LogLevel
  }) {
    this.logLevel = logLevel

    try {
      // if there is an error creating these files, this.ready won't be set true and caller will handle this
      this.logsFile = createFile(`${buildLogsDir}/${filenameUtils.logsFile({ buildId: projectBuild.id })}`) // prettier-ignore
      this.eventsFile = createFile(`${buildLogsDir}/${filenameUtils.eventsFile({ buildId: projectBuild.id })}`) // prettier-ignore

      this.ready = true
    } catch (err) {
      // close the file streams if they were created
      try {
        if (this.logsFile) {
          this.logsFile.end()
        }
        if (this.eventsFile) {
          this.eventsFile.end()
        }
      } catch {
        // just ignore any errors trying to close the file streams
      }

      // ignore any errors, just don't set this.ready true - caller will handle this
    }
  }

  public isReady(): boolean {
    return this.ready
  }

  public writeTaskStart(task: ProjectBuildTask, first?: boolean) {
    this.writeLogs(
      (first ? '' : '\n\n') +
        `-----\n` +
        `Logs for task: ${task.n}` +
        `\n-----\n\n`,
    )
  }

  public writeLogs(str: string) {
    // if an error already happened on write to logs files, don't even attempt to write again
    if (this.errorHappenedOnWrite) {
      return
    }

    try {
      this.logsFile?.write(str)
    } catch (err) {
      // on any write error to the logs files, don't throw but also stop writing any more logs
      this.errorHappenedOnWrite = true
    }
  }

  public writeEvent(logLevel: LogLevel, str: string) {
    // if an error already happened on write to logs files, don't even attempt to write again
    if (this.errorHappenedOnWrite) {
      return
    }

    try {
      if (this.isAtLogLevel(logLevel)) {
        this.eventsFile?.write(`${padStringToLength(logLevel, 5)} | ${currentTimeStampString()} ==> ${str}\n`) // prettier-ignore
      }
    } catch (err) {
      // on any write error to the logs files, don't throw but also stop writing any more logs
      this.errorHappenedOnWrite = true
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
