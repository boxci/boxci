import { Yellow, Underline, Green, LightBlue } from './consoleFonts'
import { commandFirstLine } from './logging'

const VERSION: string = process.env.NPM_VERSION as string

// Agent mode

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
const template = () => `

${commandFirstLine()}
Open sourced @ ${Underline(LightBlue('https://github.com/boxci/boxci'))} [MIT License]

${Underline('Usage')}

∙ ${Yellow('boxci agent')}
Run a build agent to listen for and automatically run build jobs

∙ ${Yellow(`boxci build`)}
Run a single build manually

${Underline('Config')}

∙ ${Green('command')}  Your project's build command
∙ ${Green('project')}  Your project's ID
∙ ${Green('key')}      Your project's secret key
∙ ${Green('machine')}  An identifier for the machine
∙ ${Green('retries')}  Max retries for requests. Default 10. Max 100.

Provide config via
  1) JSON/YAML file: ${Yellow('boxci.json')} / ${Yellow('boxci.yml')} at project root
  2) Command line flags: ${Yellow('--<name>')}
  3) Environment variables: ${Yellow('BOXCI_<NAME>')}

${Underline('More')}

For full documentation and examples see ${Underline(LightBlue('https://boxci.dev/docs'))} or run ${Yellow('boxci docs')}


`

export default {
  short: () => template(),
}
