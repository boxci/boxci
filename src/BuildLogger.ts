import fs from 'fs'
import { ProjectBuild } from './api'
import { padStringToLength, currentTimeStampString } from './util'
import { setupBoxCiDataForBuild, filenameUtils } from './data'
import { AgentConfig } from './config'
import Spinner from './Spinner'

export type LogLevel = 'ERROR' | 'INFO' | 'DEBUG' | 'TRACE'

const createFile = (path: string) =>
  fs.createWriteStream(path, { flags: 'a', encoding: 'utf-8' })

export default class BuildLogger {
  public logLevel: LogLevel

  private logsFile: fs.WriteStream | undefined
  private eventsFile: fs.WriteStream | undefined

  private agentName: string
  private buildId: string

  private ready: boolean = false

  constructor(
    agentConfig: AgentConfig,
    projectBuild: ProjectBuild,
    logLevel: LogLevel,
  ) {
    this.logLevel = logLevel
    this.agentName = agentConfig.agentName + ''
    this.buildId = projectBuild.id + ''

    try {
      const agentBuildDir = setupBoxCiDataForBuild({
        projectBuild,
        agentConfig,
      })

      // if there was an error, agentBuildDir will be undefined
      // just don't set this.ready true - caller will handle this
      if (agentBuildDir) {
        this.logsFile = createFile(`${agentBuildDir}/${filenameUtils.logsFile({ buildId: projectBuild.id })}`) // prettier-ignore
        this.eventsFile = createFile(`${agentBuildDir}/${filenameUtils.eventsFile({ buildId: projectBuild.id })}`) // prettier-ignore

        this.logsFile.write(this.printLogFileStartEndMessage('Start build logs') + '\n\n') // prettier-ignore
        this.eventsFile.write(this.printLogFileStartEndMessage('Start event logs') + '\n\n') // prettier-ignore

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

  private printLogFileStartEndMessage(message: string) {
    return `-----\n\n${message}\n  Agent   ${this.agentName}\n  Build   ${this.buildId}\n\n-----` // prettier-ignore
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
    this.logsFile?.write('\n\n' + this.printLogFileStartEndMessage('End build logs')) // prettier-ignore
    this.eventsFile?.write('\n\n' + this.printLogFileStartEndMessage('End event logs')) // prettier-ignore

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
