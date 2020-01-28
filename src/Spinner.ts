import ora, { Ora } from 'ora'

export class Spinner {
  private spinner: Ora | undefined

  constructor(text: string) {
    this.spinner = ora({ text }).start()
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

export default (text: string): Spinner => new Spinner(text)
