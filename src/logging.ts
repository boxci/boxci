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

export const getAgentTitle = () => {
  const title = 'Box CI agent'
  const version = `v${VERSION}`
  const space = '   '
  const line = lineOfLength((title + space + version).length)
  const titleString = `${Bright(title)}${space}${version}`

  return `\

${LightBlue(line)}
${titleString}
${LightBlue(line)}

`
}

export const formattedTime = (timestamp: number, at: string = '@'): string => {
  const format = `YYYY-MM-DD [${at}] HH:mm:ss`
  return timestamp
    ? // the square brackets escape the at string so it isn't interpreted as part of the format
      dayjs(timestamp).format(format)
    : // if timestamp is null at runtime, just return a blank placeholder of the same length.
      // This might happen if say metadata isn't complete, because of a bug or a corrupted file,
      // and the types say the timestamp is present but it actually isn't
      spaces(format.length)
}

export const spaces = (length: number) => Array(length + 1).join(' ')

export const padRight = (str: string, length: number) => {
  const buffer = spaces(length)

  return (str + buffer).substring(0, buffer.length)
}

export const formatAsTable = ({
  rows,
  columns,
  columnPaddingSpaces = 3,
  tableIndent = '',
}: {
  rows: Array<{ [key: string]: string }>
  columns: Array<{ label: string; field: string }>
  columnPaddingSpaces?: number
  tableIndent?: string
}): {
  header: string
  rows: string
} => {
  const columnFormatting: { [key: string]: { maxLength: number } } = {}

  columns.forEach(({ field }) => {
    let maxLength = 0

    rows.forEach((row) => {
      maxLength = Math.max(row[field].length, maxLength)
    })

    columnFormatting[field] = { maxLength }
  })

  // header row
  let header = tableIndent
  columns.forEach(({ field, label }) => {
    header += padRight(label, columnFormatting[field].maxLength + columnPaddingSpaces) // prettier-ignore
  })

  // all builds in one group
  let rowsOutput = ''
  rows.forEach((row, index) => {
    rowsOutput += tableIndent

    columns.forEach(({ field }) => {
      rowsOutput += `${padRight(row[field], columnFormatting[field].maxLength + columnPaddingSpaces)}` // prettier-ignore
    })

    if (index < rows.length - 1) {
      rowsOutput += '\n'
    }
  })

  return {
    header,
    rows: rowsOutput,
  }
}
