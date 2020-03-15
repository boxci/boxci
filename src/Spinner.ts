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

const testModeLogMessage = (message: string) => {
  console.log(`[spinner test mode] ${message}`)
}
export default class Spinner {
  private spinner: Ora = ora()
  private isActive: boolean = false
  private isShowingConnecting: boolean = false
  private options: SpinnerOptions
  private getOptionsForShowConnecting:
    | ((options: SpinnerOptions) => SpinnerOptions)
    | undefined
  private testMode: boolean = false

  constructor(
    options: SpinnerOptions,
    getOptionsForShowConnecting:
      | ((options: SpinnerOptions) => SpinnerOptions)
      | undefined,
    testMode?: boolean,
  ) {
    this.options = { ...options }
    this.getOptionsForShowConnecting = getOptionsForShowConnecting
    this.updateSpinnerOptions(options)
  }

  public setTestMode(value: boolean) {
    // if enabled, don't show the spinner
    // so that console.log can be used
    // to show order of calls
    this.testMode = value
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
    if (this.testMode) {
      testModeLogMessage('start called, isActive: ' + this.isActive + ', isShowingConnecting: ' + this.isShowingConnecting) // prettier-ignore
    }

    if (!this.isActive) {
      this.isActive = true

      if (this.testMode) {
        testModeLogMessage('started')
      } else {
        this.spinner.start()
      }
    }
  }

  // stop the spinner, with text if provided
  public stop(text?: string) {
    if (this.testMode) {
      testModeLogMessage('stop called, isActive: ' + this.isActive + ', isShowingConnecting: ' + this.isShowingConnecting) // prettier-ignore
    }

    if (this.isActive) {
      this.isActive = false

      if (this.testMode) {
        testModeLogMessage('stopped')
      } else {
        this.spinner.stop().clear()
      }
    }

    if (text !== undefined) {
      console.log(text)
    }
  }

  // special method to call when http calls retry
  public showConnecting() {
    if (this.testMode) {
      testModeLogMessage('showConnecting called, isShowingConnecting: ' + this.isShowingConnecting + ', isActive: ' + this.isActive) // prettier-ignore
    }

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
    if (this.testMode) {
      testModeLogMessage('doneConnecting called, isShowingConnecting: ' + this.isShowingConnecting + ', isActive: ' + this.isActive) // prettier-ignore
    }

    if (
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
