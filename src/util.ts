export const getCurrentTimeStamp = (): number => new Date().getTime()

export const wait = (millis: number) =>
  new Promise((resolve) => setTimeout(resolve, millis))

export const randomInRange = (from: number, to: number) =>
  Math.floor(Math.random() * (to - from + 1)) + from

export const gitCommitShort = (gitCommit: string) => gitCommit.substr(0, 7)
