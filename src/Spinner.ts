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

export type SpinnerOptions = {
  text?: string
  type?: 'listening' | 'dots'
  prefixText?: string
}

export default class Spinner {
  private spinner: Ora = ora()
  private isActive: boolean = false
  private isShowingConnecting: boolean = false
  private options: SpinnerOptions
  private getOptionsForShowConnecting:
    | ((options: SpinnerOptions) => SpinnerOptions)
    | undefined

  constructor(
    options: SpinnerOptions,
    getOptionsForShowConnecting:
      | ((options: SpinnerOptions) => SpinnerOptions)
      | undefined,
  ) {
    this.options = { ...options }
    this.getOptionsForShowConnecting = getOptionsForShowConnecting
    this.updateSpinnerOptions(options)
  }

  private updateSpinnerOptions(options: SpinnerOptions) {
    if (options?.prefixText) {
      this.spinner.prefixText = options.prefixText
    }

    if (options?.text) {
      this.spinner.text = options.text
    }

    if (options?.type) {
      // @ts-ignore
      this.spinner.spinner = SPINNERS[options.type]
    }
  }

  // start the spinner
  public start() {
    if (!this.isActive) {
      this.isActive = true
      this.spinner.start()
    }
  }

  // stop the spinner, with text if provided
  public stop(text?: string) {
    if (this.isActive) {
      this.isActive = false
      this.spinner.stop().clear()
    }

    if (text !== undefined) {
      console.log(text)
    }
  }

  // special method to call when http calls retry
  public showConnecting() {
    if (
      this.getOptionsForShowConnecting !== undefined &&
      !this.isShowingConnecting
    ) {
      this.isShowingConnecting = true
      this.stop()

      // restart spinner with custom options for connecting mode
      // that work for this spinner (different spinners have different message layouts
      // and might even show different connecting messages as they show at different points
      // in the lifecycle)
      this.updateSpinnerOptions(this.getOptionsForShowConnecting(this.options))

      this.start()
    }
  }

  // special method to call when http calls finish retrying because they succeeded/failed
  public doneConnecting() {
    if (
      bug -- listening for builds spinner showing, disconnect the server and it shows reconnecting, but only for about 5 seconds, before flipping back to listening message (keep in mind error may not be 502 actually...)
      this.getOptionsForShowConnecting !== undefined &&
      this.isShowingConnecting
    ) {
      this.isShowingConnecting = false
      this.stop()

      // reset options
      this.updateSpinnerOptions(this.options)

      this.start()
    }
  }
}
