import express, {
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from 'express'
import TestService from './TestService'

const wait = (millis: number) =>
  new Promise((resolve) => setTimeout(resolve, millis))

const randomInRange = (from: number, to: number) =>
  Math.floor(Math.random() * (to - from + 1)) + from

const returnRandomTrueWithProbability = (probability: number) => {
  return Math.random() < probability
}

type TestServiceDescription = {
  description: string
  testBehaviourMiddleware: RequestHandler | undefined
}

const buildRandomLatencyMiddleware = (
  minLatency: number,
  maxLatency: number,
) => async (req: Request, res: Response, next: NextFunction) => {
  await wait(randomInRange(minLatency, maxLatency))

  next()
}

const buildRandomRequestFailureMiddleware = (
  probabilityOfAnyRandomRequestFailing: number,
) => (req: Request, res: Response, next: NextFunction) => {
  const failRequest = returnRandomTrueWithProbability(
    probabilityOfAnyRandomRequestFailing,
  )

  if (failRequest) {
    res.status(500).send()
  } else {
    next()
  }
}

const buildRandomLatencyAndRequestFailureMiddleware = (
  minLatency: number,
  maxLatency: number,
  probabilityOfAnyRandomRequestFailing: number,
) => async (req: Request, res: Response, next: NextFunction) => {
  await wait(randomInRange(minLatency, maxLatency))

  const failRequest = returnRandomTrueWithProbability(
    probabilityOfAnyRandomRequestFailing,
  )

  if (failRequest) {
    res.status(500).send()
  } else {
    next()
  }
}

const testServices: Array<TestServiceDescription> = [
  {
    description: 'perfect network conditions',
    testBehaviourMiddleware: undefined, // no extra behaviour, service just works. Since it's running locally, guaranteed perfect network conditions
  },
  {
    description: 'random latency from 0-5s',
    testBehaviourMiddleware: buildRandomLatencyMiddleware(0, 5000),
  },
  {
    description: 'random latency from 5-10s',
    testBehaviourMiddleware: buildRandomLatencyMiddleware(5000, 10000),
  },
  {
    description: 'random latency from 0-10s',
    testBehaviourMiddleware: buildRandomLatencyMiddleware(0, 10000),
  },
  {
    description: 'requests fail randomly 10% of the time',
    testBehaviourMiddleware: buildRandomRequestFailureMiddleware(0.1),
  },
  {
    description: 'requests fail randomly 20% of the time',
    testBehaviourMiddleware: buildRandomRequestFailureMiddleware(0.2),
  },
  {
    description: 'requests fail randomly 30% of the time',
    testBehaviourMiddleware: buildRandomRequestFailureMiddleware(0.3),
  },
  {
    description: 'requests fail randomly 40% of the time',
    testBehaviourMiddleware: buildRandomRequestFailureMiddleware(0.4),
  },
  {
    description: 'requests fail randomly 50% of the time',
    testBehaviourMiddleware: buildRandomRequestFailureMiddleware(0.5),
  },
  {
    description: 'requests fail randomly 60% of the time',
    testBehaviourMiddleware: buildRandomRequestFailureMiddleware(0.6),
  },
  {
    description: 'requests fail randomly 70% of the time',
    testBehaviourMiddleware: buildRandomRequestFailureMiddleware(0.7),
  },
  {
    description: 'requests fail randomly 80% of the time',
    testBehaviourMiddleware: buildRandomRequestFailureMiddleware(0.8),
  },
  {
    description: 'requests fail randomly 90% of the time',
    testBehaviourMiddleware: buildRandomRequestFailureMiddleware(0.9),
  },
  {
    description:
      'requests fail randomly 25% of the time, random latency from 0-5s',
    testBehaviourMiddleware: buildRandomLatencyAndRequestFailureMiddleware(
      0,
      5000,
      0.25,
    ),
  },
  {
    description:
      'requests fail randomly 50% of the time, random latency from 0-5s',
    testBehaviourMiddleware: buildRandomLatencyAndRequestFailureMiddleware(
      0,
      5000,
      0.5,
    ),
  },
  {
    description:
      'requests fail randomly 75% of the time, random latency from 0-5s',
    testBehaviourMiddleware: buildRandomLatencyAndRequestFailureMiddleware(
      0,
      5000,
      0.75,
    ),
  },
  {
    description:
      'requests fail randomly 25% of the time, random latency from 5-10s',
    testBehaviourMiddleware: buildRandomLatencyAndRequestFailureMiddleware(
      5000,
      10000,
      0.25,
    ),
  },
  {
    description:
      'requests fail randomly 50% of the time, random latency from 5-10s',
    testBehaviourMiddleware: buildRandomLatencyAndRequestFailureMiddleware(
      5000,
      10000,
      0.5,
    ),
  },
  {
    description:
      'requests fail randomly 75% of the time, random latency from 5-10s',
    testBehaviourMiddleware: buildRandomLatencyAndRequestFailureMiddleware(
      5000,
      10000,
      0.75,
    ),
  },
]

const withLogging = false
const basePort = 3050

express()
  // set up shutdown hook so that this test service
  // running in background can be stopped at end of run-tests.sh
  .get('/shutdown', (req: Request, res: Response) => {
    res
      .status(200)
      .send(
        'Shut down Test Service (refresh to verify, page should no loger load)',
      )

    // shut down process after 1 second wait, to allow response to send
    setTimeout(() => {
      process.exit(0)
    }, 1000)
  })
  .listen(basePort)

// start all test services
testServices.forEach((testService, i) => {
  new TestService(
    basePort + i + 1,
    withLogging,
    testService.description,
    testService.testBehaviourMiddleware,
  ).start()
})
