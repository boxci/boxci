import ora, { Ora } from 'ora'

export class Spinner {
  private spinner: Ora | undefined

  constructor(text: string, prefixText?: string) {
    const options: ora.Options = {
      text,
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

export default (text: string, prefixText?: string): Spinner =>
  new Spinner(text, prefixText)
