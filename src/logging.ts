import { Bright, LightBlue, Red, Underline, Yellow } from './consoleFonts'
import Spinner from './Spinner'
import { lineOfLength } from './util'

const VERSION: string = process.env.NPM_VERSION as string

export const printErrorAndExit = (
  message: string,
  spinner?: Spinner,
  loggerDir?: string,
) => {
  const errorMessage =
    `\n${Bright(Red(Underline(`Error`)))}\n\n` +
    `${message}\n\n` +
    (loggerDir
      ? `Log files available in this directory: ${LightBlue(loggerDir)}\n\n`
      : '') +
    `Run ${Yellow('boxci --help')} for documentation\n\n`

  if (spinner) {
    spinner.stop(errorMessage)
  } else {
    console.log(errorMessage)
  }

  process.exit(1)
}

export const commandFirstLine = (type?: string) =>
  `${Bright(`Box CI` + (type ? ` ${type}` : ''))}     v${VERSION}`

export const printTitle = () => {
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
