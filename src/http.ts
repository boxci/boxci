import fetch, { Response } from 'node-fetch'
import { getCurrentTimeStamp, wait, randomInRange } from './util'
import { ProjectConfig } from './config'
import Spinner from './Spinner'
import { LightBlue } from './consoleFonts'

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

const maxRetriesExceededError = (
  maxRetries: number,
  url: string,
  err: Error | number,
) =>
  new Error(
    `Exceeded max retries [${maxRetries}] for POST ${url}\n\n` +
      `The last request failed with ` +
      (typeof err === 'number'
        ? `status code [${err}]`
        : `the following Error:\n\n${err}`) +
      '\n\n',
  )

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
        spinner?.stop(
          `\n\nStopped because the configured key is invalid for project ${projectConfig.projectId}\n\n` +
          `It may have been renewed. Check the key at ${LightBlue(projectConfig.service + '/p/' +projectConfig.projectId)}\n\n`)

        process.exit(1)
      } else if (res.status === 403) {
        spinner?.stop(`\n\nStopped because of an issue with your configuration for project ${projectConfig.projectId}\n\n`)

        process.exit(1)
      }

      // if maxRetries set and exceeded, just throw an error to exit
      if (maxRetries !== undefined && retryCount === maxRetries) {
        // prettier-ignore
        //log('DEBUG', () => `POST ${url} - Request failed with status ${res.status} - Max number of retries (${config.retries}) reached`)

        throw maxRetriesExceededError(maxRetries, url, res.status)
      }

      // prettier-ignore
      //log('INFO', () => `POST ${url} - Request failed with status ${res.status} - Retrying (attempt ${retryCount + 1} of ${config.retries})`)
    }

    // prettier-ignore
    //log('DEBUG', () => `POST ${url} - Responded in ${getCurrentTimeStamp() - start}ms`)
  } catch (err) {
    // if maxRetries set and exceeded, just throw an error to exit
    if (maxRetries !== undefined && retryCount === maxRetries) {
      // prettier-ignore
      //log('DEBUG', () => `POST ${url} - Request failed - cause:\n${err}\nMax number of retries (${config.retries}) reached`)

      throw maxRetriesExceededError(maxRetries, url, err)
    }
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
  spinner?: Spinner,
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
  spinner?: Spinner,
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
) => async (payload: RequestPayloadType, spinner?: Spinner): Promise<void> => {
  try {
    await post(spinner, projectConfig, path, payload, retryPeriod, maxRetries)
  } catch (err) {
    // prettier-ignore
    //log('DEBUG', () => `POST ${res.url} - error\n`)

    throw err
  }
}
