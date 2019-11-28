import { Yellow, Bright, Underline } from './consoleFonts'

const VERSION: string = process.env.NPM_VERSION as string

export const OPTIONAL_OPTIONS_PLACEHOLDER = 'OPTIONAL_OPTIONS_PLACEHOLDER'
export const ADVANCED_OPTIONS_PLACEHOLDER = 'ADVANCED_OPTIONS_PLACEHOLDER'
export const END_PLACEHOLDER = 'END_PLACEHOLDER'

// Agent mode.

// Use this to run builds automatically on branch pushes or tags,
// or when you re-run builds from the UI at https://boxci.dev

// Agent mode sits and listens for build jobs created by these actions
// and runs them. You can run as many agents as you need to scale
// your build capacity as appropriate for your project.

// Direct mode.

// Use this to run builds manually, on demand.

// Direct mode can act as a complement to Agent mode, or replace it,
// depending on your workflow. It gives you total manual control over
// when builds run, and also doesn't require an agent to be run in the
// background - it just runs the build and exits.

// An example usecase is shipping hotfixes. Suppose you usual workflow
// is that anything pushed to master gets auto-built in Agent mode,
// but you can't put the hotfix on master yet, so what do you do? Well,
// you can run the build directly from the hotfix branch on your laptop
// using Direct mode. It will appear in the management console just like
// any regular build, and will even be flagged as a Direct mode build to
// let your team know this is how a non-master branch build got run.

// prettier-ignore
export const customHelpMessage = () => `

${Bright(`Box CI`)}

∙ v${VERSION}
∙ Open sourced @ ${Underline('https://github.com/boxci/boxci')} [MIT License]

${Bright('━━ Usage ━━')}

∙ ${Yellow('boxci agent')}
  Run a build agent which listens for and runs builds on branch commits/tags, or from the management console. Runs indefinitely.

∙ ${Yellow(`boxci build`)}
  Manually run a single build on demand. Runs once and exits.

Run ${Yellow('boxci usage')} for more details.



${Bright('━━ Config ━━')}

${Underline('Required')}

The only required config is your Box CI project's credentials. These can be found on the project page at ${Underline('https://boxci.dev')}

∙ ${Yellow('project')}   Your project's ID
∙ ${Yellow('key')}       Your project's secret key

${Underline('Optional')}

These optional configs are also available if you need them

∙ ${Yellow('machine')}
An identifier for the machine (e.g. my-laptop or build-server-1). Shows on project builds, and in the list of live agents, so you
can identify which agents are running where and which builds they run. If not provided, the machine is just shown as anonymous.

∙ ${Yellow('retries')}
Max number of retries for requests to the service. Can be useful if you have challenging network conditions. Range 0-100. Default 10.

---

${Underline('How to provide config')}

${Yellow('(1)')} Config file

Use a JSON or YAML format, using the option names as keys.
Provide a ${Yellow('boxci.json')} / ${Yellow('boxci.yml')} / ${Yellow('boxci.yaml')} file at the root of your project,
or to use a custom filename/location use the [${Yellow('-c')}, ${Yellow('--config')}] CLI option.
E.g. ${Yellow('boxci agent -c /config/boxci.json')}. Note the path must be an absolute path.

${Yellow('(2)')} CLI option flags

Provide these flags to ${Yellow('boxci <agent|build>')}, followed by values

${Yellow('project')}   -p,  --project
${Yellow('key')}       -k,  --key
${Yellow('machine')}   -m,  --machine
${Yellow('retries')}   -r,  --retries

${Yellow('(3)')} Environment variables

You can also provide configs via these environment variables

${Yellow('project')}   BOXCI_PROJECT
${Yellow('key')}       BOXCI_KEY
${Yellow('machine')}   BOXCI_MACHINE
${Yellow('retries')}   BOXCI_RETRIES

Configs can be provided with a combination of all the above methods. If the same config options are configured by multiple methods,
the order of preference is Environment Variable > CLI argument > config file

---

For more detailed documentation and examples see https://boxci.dev/docs


`
