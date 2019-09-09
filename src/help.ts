// TODO use a library for this, chalk probably
const consoleColors = {
  RESET: '\x1b[0m',
  Bright: '\x1b[1m',
  Dim: '\x1b[2m',
  Underline: '\x1b[4m',
  Blink: '\x1b[5m',
  Reverse: '\x1b[7m',
  Hidden: '\x1b[8m',

  FgBlack: '\x1b[30m',
  FgRed: '\x1b[31m',
  FgGreen: '\x1b[32m',
  FgYellow: '\x1b[33m',
  FgBlue: '\x1b[34m',
  FgMagenta: '\x1b[35m',
  FgCyan: '\x1b[36m',
  FgWhite: '\x1b[37m',

  BgBlack: '\x1b[40m',
  BgRed: '\x1b[41m',
  BgGreen: '\x1b[42m',
  BgYellow: '\x1b[43m',
  BgBlue: '\x1b[44m',
  BgMagenta: '\x1b[45m',
  BgCyan: '\x1b[46m',
  BgWhite: '\x1b[47m',
}

const Bright = (str: string) => consoleColors.Bright + str + consoleColors.RESET
const Yellow = (str: string) =>
  consoleColors.FgYellow + str + consoleColors.RESET
const Underline = (str: string) =>
  consoleColors.Underline + str + consoleColors.RESET

const VERSION: string = process.env.NPM_VERSION as string

export const OPTIONAL_OPTIONS_PLACEHOLDER = 'OPTIONAL_OPTIONS_PLACEHOLDER'
export const ADVANCED_OPTIONS_PLACEHOLDER = 'ADVANCED_OPTIONS_PLACEHOLDER'
export const END_PLACEHOLDER = 'END_PLACEHOLDER'

export const customHelpMessage = (generatedHelpMessage: string) =>
  generatedHelpMessage
    .replace(
      'Usage: boxci [options] <commandString>',
      `\n\n` +
        `${Bright(`Box CI client v${VERSION}`)}\n\n` +
        `Open sourced under the MIT license @ ${Underline(
          'https://github.com/boxci/boxci',
        )}\n\n\n\n` +
        `${Bright('Run your build')}\n\n` +
        `  ${Yellow(`> boxci 'your build command' [Options]`)}\n`,
    )

    // don't show option arg placeholders
    .replace(/<arg>/g, '     ')

    // don't show defaults
    .replace('(default: 10)', '')
    .replace('(default: "https://boxci.dev/a-p-i/cli")', '')
    .replace('(default: [])', '')

    // remove some options
    .replace('-V, --version         output the version number', '')
    .replace('-h, --help            output usage information', '')

    // organise options into groups
    .replace('Options:', `\n${Bright('Options')}\n\n` + `  ∙ required`)
    .replace(OPTIONAL_OPTIONS_PLACEHOLDER, `\n\n  ∙ optional\n`)
    .replace(ADVANCED_OPTIONS_PLACEHOLDER, `\n\n  ∙ advanced\n`)

    // indent options
    .replace('-p,', '  -p,')
    .replace('-k,', '  -k,')
    .replace('-l,', '  -l,')
    .replace('-s,', '  -s,')
    .replace('-ne,', '  -ne,')
    .replace('-ns,', '  -ns,')
    .replace('-r,', '  -r,')
    .replace('-sv,', '  -sv,')

    // examples at the end
    .replace(
      END_PLACEHOLDER,
      `\n\n\n\n` +
        `${Bright('Config file')}\n\n` +
        // prettier-ignore
        `All options above can also be defined in a JSON config file named boxci.json in the same directory you run the boxci command from.\n\n` +
        `The keys must take the long version of each option name, camelCased, e.g. --no-emojis => noEmojis\n\n` +
        // prettier-ignore
        `To configure labels, define an array of ${Yellow('{ "name": "my-label", "value": "foo" }')} objects` +
        `\n\n\n\n` +
        `${Bright('Examples')}\n\n` +
        `  ∙ run a build command and stream logs to project QWE123\n` +
        // prettier-ignore
        `    ${Yellow(`> boxci 'npm run build' \\\n        --project QWE123 \\\n        --key ABCDEFG123456`)}\n\n` +
        `  ∙ run as many commands you want, any valid shell commands work fine\n` +
        // prettier-ignore
        `    ${Yellow(`> boxci 'cd ..; npm run test && npm run build' \\\n        --project QWE123 \\\n        --key ABCDEFG123456`)}\n\n` +
        `  ∙ or for longer builds, just run a script\n` +
        // prettier-ignore
        `    ${Yellow(`> boxci 'sh ./build.sh' \\\n        --project QWE123 \\\n        --key ABCDEFG123456`)}\n\n` +
        `  ∙ add labels to a build run to attach meaningful metadata to it\n` +
        // prettier-ignore
        `    ${Yellow(`> boxci 'sh ./build.sh' \\\n        --project X01X01 \\\n        --key ABCDEFG123456 \\\n        --label git-commit,$(git rev-parse HEAD) \\\n        --label build-machine,my-laptop`)}\n\n\n` +
        // prettier-ignore
        `For more detailed documentation and examples see ${Underline(`https://boxci.dev/docs`)}` +
        `\n\n\n`,
    )
