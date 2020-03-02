import ora, { Ora } from 'ora'

const SPINNERS = {
  dots: 'dots',

  listening: {
    interval: 300,
    frames: [
      '●     ',
      '●●    ',
      '●●●   ',
      '●●●●  ',
      '●●●●● ',
      '●●●●●●',
      ' ●●●●●',
      '  ●●●●',
      '   ●●●',
      '    ●●',
      '     ●',
      '      ',
    ],
  },
}

type SpinnerType = 'listening' | 'dots'

export class Spinner {
  private spinner: Ora | undefined

  constructor(text: string, type: SpinnerType, prefixText?: string) {
    const options: ora.Options = {
      text,

      // @ts-ignore
      spinner: SPINNERS[type],
    }

    if (prefixText !== undefined) {
      // @ts-ignore
      options.prefixText = prefixText
    }

    this.spinner = ora(options).start()
  }

  public stop(text?: string) {
    this.spinner!.stop().clear()

    if (text !== undefined) {
      console.log(text)
    }
  }

  public restart() {
    this.spinner!.start()
  }
}

export default (
  text: string,
  type: SpinnerType,
  prefixText?: string,
): Spinner => new Spinner(text, type, prefixText)
