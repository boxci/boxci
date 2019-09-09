import ora, { Ora } from 'ora'
import { Config } from './config'

class ListMessageItemSpinner {
  private config: Config
  private listItemPrefix: string
  private spinner: Ora | undefined

  constructor(config: Config, listItemPrefix: string) {
    this.config = config
    this.listItemPrefix = listItemPrefix
  }

  private logListItem(text: string) {
    console.log(`${this.listItemPrefix} ${text}`)
  }

  public start(text: string) {
    if (this.config.spinners) {
      this.spinner = ora({
        prefixText: this.config.emojis ? '  ' : ' ',
        text,
      }).start()
    } else {
      this.logListItem(text)
    }

    return this
  }

  public finish(text: string) {
    if (this.spinner) {
      this.spinner.stop().clear()
    }

    this.logListItem(text)

    return this
  }
}

export default class ListMessagePrinter {
  private config: Config
  private titlePrefix: string
  private listItemPrefix: string

  constructor(config: Config) {
    this.config = config
    this.titlePrefix = config.emojis ? '📦 Box CI:' : 'Box CI:'
    this.listItemPrefix = config.emojis ? '   -' : '  -'
  }

  public printTitle(text: string) {
    console.log(`\n${this.titlePrefix} ${text}`)
  }

  public printListItem(text: string) {
    console.log(`${this.listItemPrefix} ${text}`)
  }

  public printListItemSpinner(text: string): ListMessageItemSpinner {
    return new ListMessageItemSpinner(this.config, this.listItemPrefix).start(
      text,
    )
  }
}
