import fetch, { Response } from 'node-fetch'
import { getCurrentTimeStamp, wait, randomInRange } from './util'
import { ProjectConfig } from './config'

const POST = 'POST'
const HEADER_ACCESS_KEY = 'x-boxci-key'
const HEADER_PROJECT_ID = 'x-boxci-project'
const HEADER_CONTENT_TYPE = 'Content-Type'
const APPLICATION_JSON = 'application/json'

const RANDOM_RETRY_DELAY = {
  min: 100,
  max: 300,
  decay: 1.1,
}

// never have a delay more than this, even with decay
const DELAY_MAX = 3000

const getRandomRetryDelay = (retryCount: number): number => {
  const candidate =
    randomInRange(RANDOM_RETRY_DELAY.min, RANDOM_RETRY_DELAY.max) *
    Math.pow(RANDOM_RETRY_DELAY.decay, retryCount + 1)

  if (candidate < DELAY_MAX) {
    return candidate
  }

  // if reached the max delay possible, still randomise a bit to flatten off traffic
  return DELAY_MAX - randomInRange(0, RANDOM_RETRY_DELAY.max)
}

const post = async (
  projectConfig: ProjectConfig,
  path: string,
  payload: Object,
  retryCount: number = 0,
): Promise<Response> => {
  const url = `${projectConfig.service}/a-p-i/cli${path}`
  const bodyAsJsonString = JSON.stringify(payload)

  // if (CONFIGURED_LOG_LEVEL === 'DEBUG') {
  //   log('DEBUG', () => `POST ${url} - Request Sent`)
  // } else {
  //   log('TRACE', () => `POST ${url} - body: ${bodyAsJsonString} - Request Sent`)
  // }

  const start = getCurrentTimeStamp()

  let res: Response

  try {
    res = await fetch(url, {
      method: POST,
      headers: {
        [HEADER_CONTENT_TYPE]: APPLICATION_JSON,
        [HEADER_ACCESS_KEY]: projectConfig.accessKey,
        [HEADER_PROJECT_ID]: projectConfig.projectId,
      },
      body: bodyAsJsonString,
    })

    // prettier-ignore
    //log('DEBUG', () => `POST ${url} - Responded in ${getCurrentTimeStamp() - start}ms`)
  } catch (err) {
    if (retryCount === projectConfig.retries) {
      // prettier-ignore
      //log('DEBUG', () => `POST ${url} - Request failed - cause:\n${err}\nMax number of retries (${config.retries}) reached`)

      throw new Error(
        `Exceeded maximum number of retries (${projectConfig.retries}) for POST ${url} - the last request failed with Error:\n\n${err}\n\n`,
      )
    }

    // prettier-ignore
    // if (CONFIGURED_LOG_LEVEL === 'INFO') {
    //   log('INFO', () => `POST ${url} - Request failed - Retrying (attempt ${retryCount + 1} of ${config.retries})`)
    // } else {
    //   log('DEBUG', () => `POST ${url} - Request failed - cause:\n${err}\nRetrying (attempt ${retryCount + 1} of ${config.retries})`)
    // }

    await wait(getRandomRetryDelay(retryCount))

    return post(projectConfig, path, payload, retryCount + 1)
  }

  // if the response comes has a failure code
  if (res.status >= 400) {
    // if the error is because client is not authenticated, throw immediately
    if (res.status === 401) {
      const err = Error(`Authentication error`)

      // @ts-ignore
      err.isAuthError = true

      throw err
    }

    if (retryCount === projectConfig.retries) {
      // prettier-ignore
      //log('DEBUG', () => `POST ${url} - Request failed with status ${res.status} - Max number of retries (${config.retries}) reached`)

      // prettier-ignore
      throw Error(`Exceeded maximum number of retries (${projectConfig.retries}) for POST ${url} - the last request failed with status ${res.status} -- ${JSON.stringify(await res.json())}`)
    }

    // prettier-ignore
    //log('INFO', () => `POST ${url} - Request failed with status ${res.status} - Retrying (attempt ${retryCount + 1} of ${config.retries})`)
    await wait(getRandomRetryDelay(retryCount))

    return post(projectConfig, path, payload, retryCount + 1)
  }

  return res
}

export const buildPostReturningJson = <RequestPayloadType, ResponseType>(
  projectConfig: ProjectConfig,
  path: string,
) => async (payload: RequestPayloadType): Promise<ResponseType> => {
  const res = await post(projectConfig, path, payload)

  try {
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
) => async (payload: RequestPayloadType): Promise<ResponseType | undefined> => {
  const res = await post(projectConfig, path, payload)

  if (res.status === 200) {
    try {
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
}

export const buildPostReturningNothing = <RequestPayloadType>(
  projectConfig: ProjectConfig,
  path: string,
) => async (payload: RequestPayloadType): Promise<void> => {
  await post(projectConfig, path, payload)
}
