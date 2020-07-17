import fetch, { Response } from 'node-fetch'
import { AgentConfig } from './config'
import { LightBlue, Yellow } from './consoleFonts'
import { writeAgentStoppedMeta } from './data'
import { printErrorAndExit } from './logging'
import Spinner from './Spinner'
import { getCurrentTimeStamp, randomInRange, wait } from './util'

const POST = 'POST'
const HEADER_ACCESS_KEY = 'x-boxci-k'
const HEADER_PROJECT_ID = 'x-boxci-p'
const HEADER_RETRY_COUNT = 'x-boxci-r'
const HEADER_CONTENT_TYPE = 'Content-Type'
const APPLICATION_JSON = 'application/json'

const addNoise = (retryPeriod: number) => {
  // noise is +- 20% of retryPeriod
  const noiseMagnitude = Math.floor(retryPeriod / 5)

  return retryPeriod + randomInRange(noiseMagnitude * -1, noiseMagnitude)
}

const post = async ({
  spinner,
  agentConfig,
  path,
  payload,
  retries,
  indefiniteRetryPeriodOn502Error,
  retryCount = 0,
}: {
  spinner: Spinner | undefined
  agentConfig: AgentConfig
  path: string
  payload: Object
  retries: RetriesConfig
  indefiniteRetryPeriodOn502Error: number | undefined
  retryCount?: number
}): Promise<Response> => {
  const url = `${agentConfig.service}/a-p-i/cli${path}`

  // if (CONFIGURED_LOG_LEVEL === 'DEBUG') {
  //   log('DEBUG', () => `POST ${url} - Request Sent`)
  // } else {
  //   log('TRACE', () => `POST ${url} - body: ${bodyAsJsonString} - Request Sent`)
  // }

  const start = getCurrentTimeStamp()

  let maxRetriesExceededError: number | Error | undefined

  try {
    const res = await fetch(url, {
      method: POST,
      headers: {
        [HEADER_CONTENT_TYPE]: APPLICATION_JSON,
        [HEADER_ACCESS_KEY]: agentConfig.key,
        [HEADER_PROJECT_ID]: agentConfig.projectId,
        [HEADER_RETRY_COUNT]: `${retryCount}`,
      },
      body: JSON.stringify(payload),
    })

    if (res.status < 400) {
      return res
    } else {
      // for certain error codes, halt immediately and exit the cli, otherwise retry the request if applicable
      if (res.status === 401) {
        writeAgentStoppedMeta({
          agentConfig,
          stopReason: 'invalid-creds',
        })

        printErrorAndExit(
          agentConfig,
          `The provided ${Yellow('project')} & ${Yellow('key')} combination is invalid\n\n` +
          `You can find both on the project page @ ${LightBlue(`${agentConfig.service}/p/${agentConfig.projectId}/settings/keys`)}\n\n`, // prettier-ignore
          spinner,
        )
      } else if (res.status === 403) {
        writeAgentStoppedMeta({
          agentConfig,
          stopReason: 'invalid-config',
        })

        printErrorAndExit(
          agentConfig,
          `There is an issue with the configuration for project ${agentConfig.projectId}\n\n`,
          spinner,
        )
      }

      // if we encounter a 502, switch into a special mode
      // where we just loop indefinitely, but on a much slower frequency
      // to wait for the service to come back online
      if (res.status === 502 && indefiniteRetryPeriodOn502Error !== undefined) {
        try {
          if (retryCount === 0) {
            spinner?.showConnecting()
          }

          await wait(indefiniteRetryPeriodOn502Error)

          return post({
            spinner,
            agentConfig,
            path,
            payload,
            retries,
            indefiniteRetryPeriodOn502Error,
            // don't increment the retry count so we just keep
            // looping forever until either succeed or get an error other than 502
            retryCount,
          })
        } finally {
          if (retryCount === 0) {
            spinner?.doneConnecting()
          }
        }
      }

      if (retryCount === retries.max) {
        // if maxRetries set and exceeded, just throw an error to exit

        //log('DEBUG', () => `POST ${url} - Request failed with status ${res.status} - Max number of retries (${config.retries}) reached`)
        maxRetriesExceededError = res.status
      }

      //log('INFO', () => `POST ${url} - Request failed with status ${res.status} - Retrying (attempt ${retryCount + 1} of ${config.retries})`)
    }

    //log('DEBUG', () => `POST ${url} - Responded in ${getCurrentTimeStamp() - start}ms`)
  } catch (err) {
    // if maxRetries set and exceeded, just throw an error to exit
    if (retryCount === retries.max) {
      // prettier-ignore
      //log('DEBUG', () => `POST ${url} - Request failed - cause:\n${err}\nMax number of retries (${config.retries}) reached`)
      maxRetriesExceededError = err
    }
  }

  if (maxRetriesExceededError !== undefined) {
    throw new Error(
      `Exceeded max retries [${retries.max}] for POST ${url}\n\n` +
        `The last request failed with ` +
        (typeof maxRetriesExceededError === 'number'
          ? `status code [${maxRetriesExceededError}]`
          : `the following Error:\n\n${maxRetriesExceededError.message}`) +
        '\n\n',
    )
  }

  // if the request didn't succeed, start retrying,
  try {
    if (retryCount === 0) {
      spinner?.showConnecting()
    }

    // wait for the retry period +- a random amount of noise
    await wait(addNoise(retries.period))

    return post({
      spinner,
      agentConfig,
      path,
      payload,
      retries,
      retryCount: retryCount + 1,
      indefiniteRetryPeriodOn502Error,
    })
  } finally {
    if (retryCount === 0) {
      spinner?.doneConnecting()
    }
  }
}

export type RetriesConfig = {
  period: number
  max: number
}

export const buildPost = <RequestPayloadType, ResponseType>(
  path: string,
) => async ({
  agentConfig,
  payload,
  spinner,
  retries,
  indefiniteRetryPeriodOn502Error,
}: {
  agentConfig: AgentConfig
  payload: RequestPayloadType
  spinner: Spinner | undefined
  retries: RetriesConfig
  indefiniteRetryPeriodOn502Error?: number
}): Promise<ResponseType> => {
  try {
    const res = await post({
      path,
      agentConfig,
      spinner,
      payload,
      retries,
      indefiniteRetryPeriodOn502Error,
    })

    // if no content, return immediately
    if (res.status === 204) {
      // @ts-ignore yes, this isn't of type ResponseType, but in these situation we won't try to use the response
      return
    }

    const json = await res.json()

    // prettier-ignore
    //log('TRACE', () => `POST ${res.url} - response payload: ${JSON.stringify(json)}`)

    return json as ResponseType
  } catch (err) {
    // prettier-ignore
    //log('DEBUG', () => `POST ${res.url} - Could not parse JSON from response:\nstatus: ${res.status}\ncontent-type:${res.headers.get('content-type')}\n`)

    throw err
  }
}
