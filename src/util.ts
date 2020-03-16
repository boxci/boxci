import fs from 'fs'

export const getCurrentTimeStamp = (): number => new Date().getTime()

export const wait = (millis: number) =>
  new Promise((resolve) => setTimeout(resolve, millis))

export const randomInRange = (from: number, to: number) =>
  Math.floor(Math.random() * (to - from + 1)) + from

export const readFile = (path: string) => fs.readFileSync(path, 'utf-8')

export const gitCommitShort = (gitCommit: string) => gitCommit.substr(0, 7)

const RANDOM_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'
const RANDOM_ID_CHARS_LENGTH = RANDOM_ID_CHARS.length

export const randomId = (length: number) => {
  let id = ''

  for (var i = 0; i < length; i++) {
    id += RANDOM_ID_CHARS.charAt(
      Math.floor(Math.random() * RANDOM_ID_CHARS_LENGTH),
    )
  }

  return id
}

export const currentTimeStampString = () => {
  const locaTimezoneOffset = new Date().getTimezoneOffset() * 60000

  return new Date(Date.now() - locaTimezoneOffset).toISOString().slice(0, -1)
}

export const spaces = (length: number) => {
  let output = ''

  for (let i = 0; i < length; i++) {
    output += ' '
  }

  return output
}

export const padStringToLength = (
  str: string,
  length: number,
  prefixPadding?: boolean,
) => {
  const padding = spaces(length - str.length)

  return prefixPadding ? padding + str : str + padding
}

export const millisecondsToHoursMinutesSeconds = (milliseconds: number) => ({
  hours: Math.floor((milliseconds / (1000 * 60 * 60)) % 24),
  minutes: Math.floor((milliseconds / (1000 * 60)) % 60),
  seconds: Math.floor((milliseconds / 1000) % 60),
})

export const lineOfLength = (length: number) => {
  let line = ''

  for (let i = 0; i < length; i++) {
    line += '─'
  }

  return line
}
