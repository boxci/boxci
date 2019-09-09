// import 'source-map-support/register' // enables node stacktraces with webpack
import express, { Application, Request, Response } from 'express'
import cookieParser from 'cookie-parser'
import bodyParser from 'body-parser'
import { v4 as uuidv4 } from 'uuid'
import {
  LogsRequestBody,
  DoneRequestBody,
  StartRequestBody,
  LogsChunk,
} from '../../src/api'
import { RequestHandler } from 'express-serve-static-core'
import { NextFunction } from 'connect'

class ProjectBuildLogType {
  chunks: Array<LogsChunk> = []
  printedPointer: number = 0
}

export class ProjectBuild {
  command: string
  done: DoneRequestBody | null
  stdout: ProjectBuildLogType
  stderr: ProjectBuildLogType

  constructor(command: string) {
    this.command = command
    this.done = null
    this.stdout = new ProjectBuildLogType()
    this.stderr = new ProjectBuildLogType()
  }
}

const doNothingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  next()
}

export default class TestService {
  private port: number
  private withLogging: boolean
  private app: Application
  private projectBuilds: { [runId: string]: ProjectBuild } = {}

  constructor(
    port: number,
    withLogging: boolean,
    description: string,
    testBehaviourMiddleware?: RequestHandler,
  ) {
    this.port = port
    this.withLogging = withLogging
    this.app = express()
      .use(cookieParser())
      .use(bodyParser.json())

    // this is how we inject behaviours like random
    // request delays and failures for the test services
    this.setupRoutes(
      description,
      testBehaviourMiddleware || doNothingMiddleware,
    )
  }

  private setupRoutes(
    description: string,
    testBehaviourMiddleware: RequestHandler,
  ) {
    this.app.post(
      '/start',
      testBehaviourMiddleware,
      (req: Request, res: Response) => {
        const payload: StartRequestBody = req.body
        const projectBuildId = uuidv4()

        this.log(`> START RUN ${projectBuildId} - ${payload.commandString}`)
        this.projectBuilds[projectBuildId] = new ProjectBuild(
          payload.commandString,
        )

        res.status(200).json({ projectBuildId })
      },
    )

    this.app.post(
      '/logs',
      testBehaviourMiddleware,
      (req: Request, res: Response) => {
        const payload: LogsRequestBody = req.body

        if (!payload.id) {
          this.logError(`No runId provided`)
          res.status(400).send()

          return
        }

        if (!this.projectBuilds[payload.id]) {
          this.logError(`runId ${payload.id} not found`)
          res.status(404).send()

          return
        }

        const runLogType = this.projectBuilds[payload.id][payload.t]

        runLogType.chunks[payload.i] = payload.c

        // print all logs possible for the logType
        let print = true
        while (print) {
          const chunk = runLogType.chunks[runLogType.printedPointer]
          if (chunk !== undefined) {
            if (this.withLogging) {
              process[payload.t].write(chunk.c)
            }
            runLogType.printedPointer++
          } else {
            print = false // break
          }
        }

        res.status(200).send()
      },
    )

    this.app.post(
      '/done',
      testBehaviourMiddleware,
      (req: Request, res: Response) => {
        const payload: DoneRequestBody = req.body

        if (!payload.projectBuildId) {
          this.logError(`No runId provided`)
          res.status(400).send()

          return
        }

        if (!this.projectBuilds[payload.projectBuildId]) {
          this.logError(`runId ${payload.projectBuildId} not found`)
          res.status(404).send()

          return
        }

        this.projectBuilds[payload.projectBuildId].done = payload

        const remainingStdout =
          payload.commandLogsTotalChunksStdout -
          this.projectBuilds[payload.projectBuildId].stdout.printedPointer
        const remainingStderr =
          payload.commandLogsTotalChunksStderr -
          this.projectBuilds[payload.projectBuildId].stderr.printedPointer

        this.log(
          `\n-> RUN ${payload.projectBuildId} DONE - waiting for ${remainingStdout} more stdout chunks, ${remainingStderr} more stderr chunks`,
        )

        res.status(200).send()
      },
    )

    // prints the description in the test output
    this.app.get('/description', (req: Request, res: Response) => {
      console.log(`\n\n\n-----\nTest:  "${description}"\n-----\n`)
      res.status(200).send()
    })

    this.app.get('/project-builds', (req: Request, res: Response) => {
      res.status(200).json(this.projectBuilds)
    })
  }

  private log(...args: any[]) {
    if (this.withLogging) {
      console.log(...args)
    }
  }

  private logError(...args: any[]) {
    if (this.withLogging) {
      console.error('ERROR:', ...args)
    }
  }

  public async start() {
    return new Promise((resolve, reject) => {
      this.app.listen(this.port, (err) => {
        if (err) {
          reject(err)
        } else {
          this.log(`server started on http://localhost:${this.port}/`)
          resolve()
        }
      })
    })
  }
}
