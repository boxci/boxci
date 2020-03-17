import { Bright, LightBlue, Red, Underline, Yellow } from './consoleFonts'
import Spinner from './Spinner'

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
