import fs from 'fs'
import { ProjectBuild } from './api'
import { padStringToLength, currentTimeStampString } from './util'
import { setupBoxCiDataForBuild } from './data'
import { AgentConfig } from './config'
import Spinner from './Spinner'

export type LogLevel = 'ERROR' | 'INFO' | 'DEBUG' | 'TRACE'

const createFile = (path: string) =>
  fs.createWriteStream(path, { flags: 'a', encoding: 'utf-8' })

export default class BuildLogger {
  public logLevel: LogLevel

  private logsFile: fs.WriteStream | undefined
  private eventsFile: fs.WriteStream | undefined

  private ready: boolean = false

  constructor(
    agentConfig: AgentConfig,
    projectBuild: ProjectBuild,
    logLevel: LogLevel,
  ) {
    this.logLevel = logLevel

    try {
      const agentBuildDir = setupBoxCiDataForBuild({
        projectBuild,
        agentConfig,
      })

      // if there was an error, agentBuildDir will be undefined
      // just don't set this.ready true - caller will handle this
      if (agentBuildDir) {
        this.logsFile = createFile(
          `${agentBuildDir}/logs-${projectBuild.id}.txt`,
        )
        this.eventsFile = createFile(
          `${agentBuildDir}/events-${projectBuild.id}.txt`,
        )

        this.ready = true
      }
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
