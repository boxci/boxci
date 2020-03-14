import fetch, { Response } from 'node-fetch'
import { getCurrentTimeStamp, wait, randomInRange } from './util'
import { ProjectConfig } from './config'
import Spinner from './Spinner'
import { LightBlue, Green, Yellow } from './consoleFonts'
import { printErrorAndExit } from './logging'

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

const post = async (
  spinner: Spinner | undefined,
  projectConfig: ProjectConfig,
  path: string,
  payload: Object,
  retryPeriod: number,
  maxRetries: number | undefined,
  retryCount: number = 0,
): Promise<Response> => {
  const url = `${projectConfig.service}/a-p-i/cli${path}`

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
        [HEADER_ACCESS_KEY]: projectConfig.accessKey,
        [HEADER_PROJECT_ID]: projectConfig.projectId,
        [HEADER_RETRY_COUNT]: `${retryCount}`,
      },
      body: JSON.stringify(payload),
    })

    if (res.status < 400) {
      return res
    } else {
      // for certain error codes, halt immediately and exit the cli, otherwise retry the request if applicable
      if (res.status === 401) {
        printErrorAndExit(
          `Stopped because the configured project ID ${Yellow(projectConfig.projectId)} and key combination is invalid\n\n` +
          `Check the project ID is correct, and the key value @ ${LightBlue(`${projectConfig.service}/p/${projectConfig.projectId}/settings/keys`)}\n\n`, // prettier-ignore
          spinner,
        )
      } else if (res.status === 403) {
        printErrorAndExit(
          `Stopped because of an issue with your configuration for project ${projectConfig.projectId}\n\n`,
          spinner,
        )
      }

      // if we encounter a 502, switch into a special mode
      // where we just loop indefinitely, but on a much slower frequency
      // to wait for the service to come back online
      if (res.status === 502) {
        try {
          if (retryCount === 0) {
            spinner?.showConnecting()
          }

          await wait(30000) // wait 30 seconds between retries

          return post(
            spinner,
            projectConfig,
            path,
            payload,
            retryPeriod,
            maxRetries,
            // don't increment the retry count so we just keep
            // looping forever until either succeed or get an error other than 502
            retryCount,
          )
        } finally {
          if (retryCount === 0) {
            spinner?.doneConnecting()
          }
        }
      }

      // if maxRetries set and exceeded, just throw an error to exit
      if (maxRetries !== undefined && retryCount === maxRetries) {
        //log('DEBUG', () => `POST ${url} - Request failed with status ${res.status} - Max number of retries (${config.retries}) reached`)
        maxRetriesExceededError = res.status
      }

      //log('INFO', () => `POST ${url} - Request failed with status ${res.status} - Retrying (attempt ${retryCount + 1} of ${config.retries})`)
    }

    //log('DEBUG', () => `POST ${url} - Responded in ${getCurrentTimeStamp() - start}ms`)
  } catch (err) {
    // if maxRetries set and exceeded, just throw an error to exit
    if (maxRetries !== undefined && retryCount === maxRetries) {
      // prettier-ignore
      //log('DEBUG', () => `POST ${url} - Request failed - cause:\n${err}\nMax number of retries (${config.retries}) reached`)
      maxRetriesExceededError = err
    }
  }

  if (maxRetriesExceededError !== undefined) {
    throw new Error(
      `Exceeded max retries [${maxRetries}] for POST ${url}\n\n` +
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
    await wait(addNoise(retryPeriod))

    return post(
      spinner,
      projectConfig,
      path,
      payload,
      retryPeriod,
      maxRetries,
      retryCount + 1,
    )
  } finally {
    if (retryCount === 0) {
      spinner?.doneConnecting()
    }
  }
}

export const buildPostReturningJson = <RequestPayloadType, ResponseType>(
  path: string,
  projectConfig: ProjectConfig,
  retryPeriod: number,
  maxRetries?: number,
) => async (
  payload: RequestPayloadType,
  spinner: Spinner | undefined,
): Promise<ResponseType> => {
  try {
    const res = await post(
      spinner,
      projectConfig,
      path,
      payload,
      retryPeriod,
      maxRetries,
    )
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

export const buildPostReturningJsonIfPresent = <
  RequestPayloadType,
  ResponseType
>(
  path: string,
  projectConfig: ProjectConfig,
  retryPeriod: number,
  maxRetries?: number,
) => async (
  payload: RequestPayloadType,
  spinner: Spinner | undefined,
  overrideMaxRetries?: number,
  overrideRetryPeriod?: number,
): Promise<ResponseType | undefined> => {
  try {
    const res = await post(
      spinner,
      projectConfig,
      path,
      payload,
      overrideRetryPeriod ?? retryPeriod,
      overrideMaxRetries ?? maxRetries,
    )
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

export const buildPostReturningNothing = <RequestPayloadType>(
  path: string,
  projectConfig: ProjectConfig,
  retryPeriod: number,
  maxRetries?: number,
) => async (
  payload: RequestPayloadType,
  spinner: Spinner | undefined,
): Promise<void> => {
  try {
    await post(spinner, projectConfig, path, payload, retryPeriod, maxRetries)
  } catch (err) {
    // prettier-ignore
    //log('DEBUG', () => `POST ${res.url} - error\n`)

    throw err
  }
}
