import { Bright, LightBlue, Red, Underline, Yellow } from './consoleFonts'
import Spinner from './Spinner'
import { lineOfLength } from './util'
import dayjs from 'dayjs'

const VERSION: string = process.env.NPM_VERSION as string

export const printErrorAndExit = (message: string, spinner?: Spinner) => {
  const errorMessage =
    '\n' +
    `${Bright(Red(Underline(`Error`)))}\n\n` +
    `${message}\n\n` +
    `${Bright('∙')} Run ${Yellow('boxci --help')} for documentation\n\n`

  if (spinner) {
    spinner.stop(errorMessage)
  } else {
    console.log(errorMessage)
  }

  process.exit(1)
}

export const printHistoryErrorAndExit = (err: Error) => {
  // prettier-ignore
  const errorMessage =
    '\n' +
    `\n\n${Bright(Red(`Error reading Box CI history`))}\n\n` +
    `${Bright('Caused by')}:\n\n${err}\n\n_____\n\n` +
    `This type of error usually occurs because your history files\nhave been manually edited or otherwise corrupted\n\n` +
    `To return your history to a clean state, run:\n\n> ${Yellow('boxci history --clean')}\n\n` +
    `∙ \n\n`

  console.log(errorMessage)

  process.exit(1)
}

export const commandFirstLine = (type?: string) =>
  `${Bright(`Box CI` + (type ? ` ${type}` : ''))}     v${VERSION}`

export const printAgentTitle = () => {
  const title = 'Box CI agent'
  const version = `v${VERSION}`
  const space = '   '
  const line = lineOfLength((title + space + version).length)
  const titleString = `${Bright(title)}${space}${version}`

  console.log('')
  console.log(LightBlue(line))
  console.log(titleString)
  console.log(LightBlue(line))
  console.log('')

  return line
}

export const formattedStartTime = (timestamp: number): string =>
  // if timestamp is null at runtime, just return a blank placeholder of the same length
  // this might happen if say metadata isn't complete, because of a bug or a corrupted file,
  // and the types say the timestamp is present but it actually isn't
  timestamp
    ? dayjs(timestamp).format('YYYY-MM-DD @ HH:mm:ss')
    : '                     '
