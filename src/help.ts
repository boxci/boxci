import { Yellow, Underline, LightBlue, Red, Bright } from './consoleFonts'
import { getAgentTitle } from './logging'

// prettier-ignore
const printHelp = () => `\
${getAgentTitle()}
${Bright('Documentation')}

All commands are listed below.

For more detail & examples, see ${Underline(LightBlue('https://boxci.dev/docs/agent'))}


${Yellow('boxci agent')}  - - - - - - - - - - - - - - - - - - - - - - - -

Run an agent for a project.

${Bright('Options')}
  Required
    ${Yellow('--project')}     ${Yellow('-p')}   Project ID
    ${Yellow('--key')}         ${Yellow('-k')}   Project secret key
  Optional
    ${Yellow('--machine')}     ${Yellow('-m')}   Build machine name
    ${Yellow('--no-spinner')}  ${Yellow('-ns')}  Do not show spinners in agent output


${Yellow('boxci stop <agent>')} - - - - - - - - - - - - - - - - - - - - -

Gracefully stop a running agent.

${Bright('Arguments')}
  Required
    ${Yellow('agent')}              Name of the agent


${Yellow('boxci history [mode]')} - - - - - - - - - - - - - - - - - - - -

View history of agents and builds run on this machine.

${Bright('Arguments')}
  Optional
    ${Yellow('mode')}               One of the following 3 values:

                       '${Yellow('builds')}'     list history of all
                                    builds
                       '${Yellow('projects')}'   list history of builds
                                    grouped by project
                       '${Yellow('agents')}'     list history of builds
                                    grouped by agent

                       - OR -

                       leave blank to show an overview of
                       the numbers of builds, projects and
                       agents in the history


${Yellow('boxci logs <build>')} - - - - - - - - - - - - - - - - - - - - -

Print the absolute path to the local log file for a build.

${Bright('Arguments')}
  Required
    ${Yellow('build')}              ID of the build


${Yellow('boxci clean-logs')} - - - - - - - - - - - - - - - - - - - - - -

Clean logs of builds on this machine.

${Bright('Options')}
  One Required
    ${Yellow('--build')}       ${Yellow('-b')}   A build ID.
                       Clear logs for this build
    ${Yellow('--project')}     ${Yellow('-p')}   A Project ID.
                       Clear logs of all builds for this
                       project
    ${Yellow('--all')}         ${Yellow('-a')}   Clear logs of all builds


${Yellow('boxci --version')}  - - - - - - - - - - - - - - - - - - - - - -

Show the currently installed version.


${Yellow('boxci --help')} - - - - - - - - - - - - - - - - - - - - - - - -

Show documentation.


───────────────────────────────────────────────────────────
For more detail & examples see ${Underline(LightBlue('https://boxci.dev/docs/agent'))}
───────────────────────────────────────────────────────────


`

export default {
  // needs this format to work with Commander.help() which it's passed as an argument to
  print: () => printHelp(),
}
