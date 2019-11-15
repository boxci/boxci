import ora, { Ora } from 'ora'
import { Bright } from './consoleFonts'

const VERSION: string = process.env.NPM_VERSION as string

class ListMessageItemSpinner {
  private listItemPrefix: string
  private spinner: Ora | undefined

  constructor(listItemPrefix: string) {
    this.listItemPrefix = listItemPrefix
  }

  private logListItem(text: string, prefix?: string) {
    console.log(`${prefix || this.listItemPrefix} ${text}`)
  }

  public start(text: string) {
    this.spinner = ora({
      text,
    }).start()

    return this
  }

  public finish(text: string, prefix?: string) {
    this.spinner!.stop().clear()
    this.logListItem(text, prefix)

    return this
  }
}

export default class ListMessagePrinter {
  public printTitle(directBuild: boolean) {
    console.log(`\n│ ${Bright('Box CI')}  v${VERSION}\n│\n│ Running ${directBuild ? 'direct build' : 'agent build'}\n│`) // prettier-ignore
  }

  public printItem(text: string) {
    console.log(`├ ${text}`)
  }

  public printListItemSpinner(text: string): ListMessageItemSpinner {
    return new ListMessageItemSpinner('├').start(text)
  }
}
