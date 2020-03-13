import fetch, { Response } from 'node-fetch'
import { getCurrentTimeStamp, wait, randomInRange } from './util'
import { ProjectConfig } from './config'

const POST = 'POST'
const HEADER_ACCESS_KEY = 'x-boxci-key'
const HEADER_PROJECT_ID = 'x-boxci-project'
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
      },
      body: JSON.stringify(payload),
    })

    if (res.status < 400) {
      return res
    } else {
      // if the error is because client is not authenticated, throw immediately
      if (res.status === 401) {
        const err = Error(`Authentication error`)

        throw err
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

  // if the request didn't succeed, wait for the retry period +- a random amount of noise for a bit of variablility
  await wait(addNoise(retryPeriod))

  return post(
    projectConfig,
    path,
    payload,
    retryPeriod,
    maxRetries,
    retryCount + 1,
  )
}

export const buildPostReturningJson = <RequestPayloadType, ResponseType>(
  projectConfig: ProjectConfig,
  path: string,
  retryPeriod: number,
  maxRetries?: number,
) => async (payload: RequestPayloadType): Promise<ResponseType> => {
  try {
    const res = await post(
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
  projectConfig: ProjectConfig,
  path: string,
  retryPeriod: number,
  maxRetries?: number,
) => async (payload: RequestPayloadType): Promise<ResponseType | undefined> => {
  try {
    const res = await post(
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

export const buildPostReturningNothing = <RequestPayloadType>(
  projectConfig: ProjectConfig,
  path: string,
  retryPeriod: number,
  maxRetries?: number,
) => async (payload: RequestPayloadType): Promise<void> => {
  try {
    await post(projectConfig, path, payload, retryPeriod, maxRetries)
  } catch (err) {
    // prettier-ignore
    //log('DEBUG', () => `POST ${res.url} - error\n`)

    throw err
  }
}
