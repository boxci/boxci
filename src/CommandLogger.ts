import * as shelljs from 'shelljs'
import { CONFIGURED_LOG_LEVEL, log } from './logging'
import { getCurrentTimeStamp } from './util'
import { Api, LogType } from './api'
import { Config } from './config'

type AllLogsSentResult = {
  errors: boolean
  doneEventError?: Error
  sendChunkErrors?: Array<Error>
}

const NEWLINES_REGEX: RegExp = /\r\n|\r|\n/

export default class CommandLogger {
  private commandString: string
  private projectBuildId: string

  private start: number = getCurrentTimeStamp()
  private end: number | undefined

  private stdout: string = ''
  private stderr: string = ''

  private stdoutAvailable: boolean = true
  private stderrAvailable: boolean = true

  private promises: { [logType in LogType]: Array<Promise<any>> } = {
    stdout: [],
    stderr: [],
  }

  private commandFinished: Promise<{ runtimeMs: number }>
  private resolveCommandFinishedPromise: (args: { runtimeMs: number }) => void

  private allLogsSent: Promise<AllLogsSentResult>
  private resolveAllLogsSentPromise: (
    allLogsSentResult: AllLogsSentResult,
  ) => void

  private api: Api

  constructor(
    config: Config,
    projectBuildId: string,
    commandString: string,
    api: Api,
    cwd: string,
  ) {
    this.projectBuildId = projectBuildId
    this.commandString = commandString
    this.api = api

    this.resolveCommandFinishedPromise = (args: { runtimeMs: number }) => {
      throw Error(
        'CommandLogger.resolveCommandFinishedPromise() called before being bound to commandFinished Promise',
      )
    }

    this.commandFinished = new Promise((resolve) => {
      this.resolveCommandFinishedPromise = (args: { runtimeMs: number }) => {
        resolve(args)
      }
    })

    this.resolveAllLogsSentPromise = (allLogsSentResult: AllLogsSentResult) => {
      throw Error(
        'CommandLogger.resolveAllLogsSentPromise() called before being bound to allLogsSent Promise',
      )
    }

    this.allLogsSent = new Promise((resolve, reject) => {
      this.resolveAllLogsSentPromise = (
        allLogsSentResult: AllLogsSentResult,
      ) => {
        resolve(allLogsSentResult)
      }
    })

    const { stdout, stderr } = shelljs.exec(
      commandString,
      {
        async: true,
        silent: config.silent,

        // sets shelljs current working directory to where the cli is run from,
        // instead of the directory where the cli script is
        cwd,
      },
      (code: number) => {
        this.setCommandFinished(code)
      },
    )

    // prettier-ignore
    log('INFO', () => `Running command "${this.commandString}" - runId ${projectBuildId}`)

    if (stdout) {
      stdout.on('data', (chunk: string) => {
        this.sendChunk('stdout', chunk)
      })
      log('DEBUG', () => `Listening to stdout for "${this.commandString}"`)
    } else {
      this.stdoutAvailable = false
      // prettier-ignore
      log('DEBUG', () => `No stdout available for "${this.commandString}"`)
    }

    if (stderr) {
      stderr.on('data', (chunk: string) => {
        this.sendChunk('stderr', chunk)
      })
      log('DEBUG', () => `Listening to stderr for "${this.commandString}"`)
    } else {
      this.stderrAvailable = false
      // prettier-ignore
      log('DEBUG', () => `No stderr available for "${this.commandString}"`)
    }
  }

  public whenCommandFinished() {
    return this.commandFinished
  }

  public whenAllLogsSent() {
    return this.allLogsSent
  }

  private async sendChunk(logType: LogType, chunkContent: string) {
    const chunkIndex = this.promises[logType].length
    log('DEBUG', () => `Sending ${logType} chunk index ${chunkIndex}`)

    const chunkSentPromise = this.api
      .logs({
        // project build id
        id: this.projectBuildId,
        // log type
        t: logType,
        // chunk index
        i: chunkIndex,
        // chunk
        c: {
          // content
          c: chunkContent,
          // time since start in milliseconds
          t: getCurrentTimeStamp() - this.start,
          // starting line number (0 based)
          l: this[logType].split(NEWLINES_REGEX).length - 1,
        },
      })
      .catch((err) => {
        // catch and return any thrown error as the resolved value of the promise, i.e
        // do not throw, stop the program, and stop other requests from sending
        // we'll send as many chunks as we can, then once all promises have resolved,
        // check if any of them resolved to errors and show the errors at the end
        // by rejecting the allLogsSent promise
        return err
      })

    // add to the complete log string to get starting lineNumber for future chunks
    this[logType] += chunkContent

    this.promises[logType].push(chunkSentPromise)

    return chunkSentPromise
  }

  private async setCommandFinished(commandReturnCode: number): Promise<void> {
    this.end = getCurrentTimeStamp()
    const commandRuntimeMillis = this.end - this.start

    const commandLogsTotalChunksStdout = this.promises.stdout.length + 0
    const commandLogsTotalChunksStderr = this.promises.stderr.length + 0

    // prettier-ignore
    if (CONFIGURED_LOG_LEVEL === 'INFO') {
      log('INFO', () => `Command finished in ${commandRuntimeMillis}ms with code ${commandReturnCode} - sending done event`)
    } else {
      log('DEBUG', () => `Command finished in ${commandRuntimeMillis}ms with code ${commandReturnCode} - ${commandLogsTotalChunksStdout} stdout chunks - ${commandLogsTotalChunksStderr} stderr chunks - sending done event`)
    }

    this.resolveCommandFinishedPromise({ runtimeMs: commandRuntimeMillis })

    // send the done event and also wait for all still outgoing stout and stderr chunks to send before resolving
    const doneEventSent = this.api
      .done({
        projectBuildId: this.projectBuildId,
        commandReturnCode,
        commandRuntimeMillis,
        commandLogsTotalChunksStdout,
        commandLogsTotalChunksStderr,
        commandLogsAvailableStdout: this.stdoutAvailable,
        commandLogsAvailableStderr: this.stderrAvailable,
      })
      .catch((err) => {
        // return the error as the resolved value of the promise, see notes above
        return err
      })

    const [doneEventResult, ...results] = await Promise.all([
      doneEventSent,
      ...this.promises.stdout,
      ...this.promises.stderr,
    ])

    const isDoneEventError = doneEventResult instanceof Error
    const sendChunkErrors: Array<Error> = []
    for (let result of results) {
      if (result instanceof Error) {
        sendChunkErrors.push(result)
      }
    }

    if (!isDoneEventError && sendChunkErrors.length === 0) {
      this.resolveAllLogsSentPromise({
        errors: false,
      })
    } else {
      this.resolveAllLogsSentPromise({
        errors: true,
        doneEventError: isDoneEventError
          ? (doneEventResult as Error)
          : undefined,
        sendChunkErrors,
      })
    }
  }
}
