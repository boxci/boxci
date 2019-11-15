import { Yellow, Bright, Underline } from './consoleFonts'

const VERSION: string = process.env.NPM_VERSION as string

export const OPTIONAL_OPTIONS_PLACEHOLDER = 'OPTIONAL_OPTIONS_PLACEHOLDER'
export const ADVANCED_OPTIONS_PLACEHOLDER = 'ADVANCED_OPTIONS_PLACEHOLDER'
export const END_PLACEHOLDER = 'END_PLACEHOLDER'

// prettier-ignore
export const customHelpMessage = () => `

${Bright(`Box CI client v${VERSION}`)}

Open sourced under the MIT license @ ${Underline('https://github.com/boxci/boxci')}

${Bright('Usage')}

The cli has 2 modes of usage: ${Bright('agent')} and ${Bright('build')}

  ${Bright('agent')}

    This starts a Box CI agent which listens for build jobs from the service and runs them automatically.
    This is a long-running process that will run indefinitely until you stop it.

    ${Yellow(`> boxci agent [Options]`)}

  ${Bright('build')}

    This starts a Box CI build and pushes it to the service.
    This is a one-time process that ends when the build finishes.

    ${Yellow(`> boxci build 'your build command' [Options]`)}


You can think of ${Yellow('agent')} as automatic mode, and ${Yellow('build')} as manual mode.
How you use the two depends on your setup, and how you want to use Box CI, but ${Yellow('agent')}
enables some extra features like the ability to start builds from the Box CI web dashboard or on
git commits, tags, etc. For these to work, you need agents always on and listening to execute these
build jobs. ${Yellow('build')} mode is more for running ad-hoc builds directly from your laptop, for example,
which can either supplement or replace the need to run agents. It depends on your workflow.


${Bright('Options')} (for both build and agent mode)

  ∙ required

    -p, --project          Project ID (find on the project page on boxci.dev)
    -k, --key              Project access key (find on the project page on boxci.dev)

  ∙ optional

    -l, --label            Add a label to this build run. Syntax: key,value. For multiple labels, repeat the option
    -s, --silent           Do not display build command output (default: false)
    -ne, --no-emojis       No emojis in boxci messaging. Does not affect build command output
    -ns, --no-spinners     No spinners in boxci messaging. Does not affect build command output

  ∙ advanced

    -r, --retries          Max retries for requests to the service. Range 0-100. Default 10
    -sv, --service         Service URL. Only use if you are using your own service implementation instead of Box CI



${Bright(`Config File`)}

All options above can also be defined in a JSON config file named boxci.json in the same directory you run the boxci command from.

The keys must take the long version of each option name, camelCased, e.g. ${Yellow(`--no-emojis`)} => ${Yellow(`noEmojis`)}

To configure labels, define an array of ${Yellow(`{ "name": "my-label", "value": "foo" }`)} objects



${Bright(`Examples`)}

  ∙ run a build command and stream logs to project QWE123
    ${Yellow(`> boxci 'npm run build' \\`)}


  ∙ run as many commands you want, any valid shell commands work fine
    ${Yellow(`> boxci 'cd ..; npm run test && npm run build' \\`)}
    ${Yellow(`  --project QWE123 \\`)}
    ${Yellow(`  --key ABCDEFG123456`)}

  ∙ or for longer builds, just run a script
    ${Yellow(`> boxci 'sh ./build.sh' \\`)}
    ${Yellow(`  --project QWE123 \\`)}
    ${Yellow(`  --key ABCDEFG123456`)}

  ∙ add labels to a build run to attach meaningful metadata to it
    ${Yellow(` > boxci 'sh ./build.sh' \\`)}
    ${Yellow(`  --project QWE123 \\`)}
    ${Yellow(`  --key ABCDEFG123456 \\`)}
    ${Yellow(`  --label git-commit,$(git rev-parse HEAD) \\`)}
    ${Yellow(`  --label build-machine,my-laptop`)}


For more detailed documentation and examples see https://boxci.dev/docs


`
