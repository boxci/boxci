import 'isomorphic-fetch'
import { CONFIGURED_LOG_LEVEL, log } from './logging'
import { getCurrentTimeStamp, wait, randomInRange } from './util'
import { Config } from './config'

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
  config: Config,
  path: string,
  payload: Object,
  retryCount: number = 0,
): Promise<Response> => {
  const url = `${config.service}${path}`
  const bodyAsJsonString = JSON.stringify(payload)

  if (CONFIGURED_LOG_LEVEL === 'DEBUG') {
    log('DEBUG', () => `POST ${url} - Request Sent`)
  } else {
    log('TRACE', () => `POST ${url} - body: ${bodyAsJsonString} - Request Sent`)
  }

  const start = getCurrentTimeStamp()

  let res: Response

  try {
    res = await fetch(url, {
      method: POST,
      headers: {
        [HEADER_CONTENT_TYPE]: APPLICATION_JSON,
        [HEADER_ACCESS_KEY]: config.accessKey,
        [HEADER_PROJECT_ID]: config.projectId,
      },
      body: bodyAsJsonString,
    })

    // prettier-ignore
    log('DEBUG', () => `POST ${url} - Responded in ${getCurrentTimeStamp() - start}ms`)
  } catch (err) {
    if (retryCount === config.retries) {
      // prettier-ignore
      log('DEBUG', () => `POST ${url} - Request failed - cause:\n${err}\nMax number of retries (${config.retries}) reached`)

      throw new Error(
        `Exceeded maximum number of retries (${config.retries}) for POST ${url} - the last request failed with Error:\n\n${err}\n\n`,
      )
    }

    // prettier-ignore
    if (CONFIGURED_LOG_LEVEL === 'INFO') {
      log('INFO', () => `POST ${url} - Request failed - Retrying (attempt ${retryCount + 1} of ${config.retries})`)
    } else {
      log('DEBUG', () => `POST ${url} - Request failed - cause:\n${err}\nRetrying (attempt ${retryCount + 1} of ${config.retries})`)
    }

    await wait(getRandomRetryDelay(retryCount))

    return post(config, path, payload, retryCount + 1)
  }

  // if the response comes, but has a failure code, retry
  if (res.status >= 400) {
    if (retryCount === config.retries) {
      // prettier-ignore
      log('DEBUG', () => `POST ${url} - Request failed with status ${res.status} - Max number of retries (${config.retries}) reached`)

      // prettier-ignore
      throw Error(`Exceeded maximum number of retries (${config.retries}) for POST ${url} - the last request failed with status ${res.status} -- ${JSON.stringify(await res.json())}`)
    }

    // prettier-ignore
    log('INFO', () => `POST ${url} - Request failed with status ${res.status} - Retrying (attempt ${retryCount + 1} of ${config.retries})`)
    await wait(getRandomRetryDelay(retryCount))

    return post(config, path, payload, retryCount + 1)
  }

  return res
}

export const buildPostReturningJson = <RequestPayloadType, ResponseType>(
  config: Config,
  path: string,
) => async (payload: RequestPayloadType): Promise<ResponseType> => {
  const res = await post(config, path, payload)

  try {
    const json = await res.json()

    // prettier-ignore
    log('TRACE', () => `POST ${res.url} - response payload: ${JSON.stringify(json)}`)

    return json as ResponseType
  } catch (err) {
    // prettier-ignore
    log('DEBUG', () => `POST ${res.url} - Could not parse JSON from response:\nstatus: ${res.status}\ncontent-type:${res.headers.get('content-type')}\n`)

    throw err
  }
}

export const buildPostReturningNothing = <RequestPayloadType>(
  config: Config,
  path: string,
) => async (payload: RequestPayloadType): Promise<void> => {
  await post(config, path, payload)
}
