import { Yellow, Bright } from '../consoleFonts'
import { BoxCIHistory, BuildMeta, readHistory } from '../data'
import { printErrorAndExit, formattedTime, formatAsTable } from '../logging'
import { Command } from 'commander'

export type HistoryCommandArgs = {
  latest: number
  mode: HistoryCommandMode
}

export type CleanHistoryCommandArgs = {
  dryRun: boolean
  hardDelete: boolean
  agentName?: string
  buildId?: string
}

export type HistoryCommandMode =
  | 'full'
  | 'builds'
  | 'builds-by-project'
  | 'builds-by-agent'

const HISTORY_COMMAND_LAST_OPTION_DEFAULT = '10'

const validateArgs = ({
  modeArgument,
  options,
}: {
  modeArgument: 'builds' | 'projects' | 'agents' | undefined
  options: {
    latest: string
  }
}): HistoryCommandArgs => {
  const validationErrors: Array<string> = []

  let latest: number = 0

  try {
    latest = parseInt(options.latest ?? HISTORY_COMMAND_LAST_OPTION_DEFAULT)

    if (latest < 1) {
      validationErrors.push(`  - ${Yellow('--latest (-l)')} must be a positive integer`) // prettier-ignore
    }
  } catch (err) {
    validationErrors.push(`  - ${Yellow('--latest (-l)')} must be a positive integer`) // prettier-ignore
  }

  let mode: HistoryCommandMode = 'full'

  if (modeArgument !== undefined) {
    if (modeArgument === 'builds') {
      mode = 'builds'
    } else if (modeArgument === 'projects') {
      mode = 'builds-by-project'
    } else if (modeArgument === 'agents') {
      mode = 'builds-by-agent'
    } else {
      validationErrors.push(`  - 1st argument must be one of { ${Yellow('builds')} | ${Yellow('projects')} | ${Yellow('agents')} }`) // prettier-ignore
    }
  }

  if (validationErrors.length > 0) {
    printErrorAndExit({ silent: false }, validationErrors.join('\n'))
  }

  return {
    latest,
    mode,
  }
}

const groupBuildsBy = (history: BoxCIHistory, field: keyof BuildMeta) => {
  const groups: { [key: string]: BuildMeta[] } = {}
  history.builds.forEach((buildMeta) => {
    const key = buildMeta[field] as string
    if (!groups[key]) {
      groups[key] = []
    }

    groups[key].push(buildMeta)
  })

  return groups
}

const printCommands = () =>
  // prettier-ignore
  `\n\n∙ Usage\n\n` +
  `  ${Yellow('boxci history')}           overview\n` +
  `  ${Yellow('boxci history builds')}    list builds\n` +
  `  ${Yellow('boxci history projects')}  list builds grouped by project\n` +
  `  ${Yellow('boxci history agents')}    list builds grouped by agent`

const full = () => {
  const history = readHistory({ silent: false })
  const projectBuilds = groupBuildsBy(history, 'p')
  const projectIds = Object.keys(projectBuilds)

  // prettier-ignore
  const message =
    `${Bright('Box CI History')}: Overview\n\n` +
    `${Bright('Builds')}     ${history.builds.length}\n` +
    `${Bright('Projects')}   ${projectIds.length}\n` +
    `${Bright('Agents')}     ${history.agents.length}`

  return message + printCommands()
}

const printNumber = (arr: any[], name: string, namePlural?: string) =>
  `${arr.length} ${arr.length === 1 ? name : namePlural ?? `${name}s`}`

const builds = () => {
  const history = readHistory({ silent: false })

  let message = `${Bright('Box CI History')}: Builds (${printNumber(history.builds, 'build')})` // prettier-ignore

  if (history.builds.length > 0) {
    const { header, rows } = formatAsTable({
      columns: [
        {
          label: 'Build ID',
          field: 'id',
        },
        {
          label: 'Project',
          field: 'p',
        },
        {
          label: 'Agent',
          field: 'a',
        },
        {
          label: 'Started',
          field: 't',
        },
      ],
      rows: history.builds.map((build) => ({
        id: build.id,
        p: build.p,
        a: build.a,
        t: formattedTime(build.t),
      })),
    })

    message += `\n\n${header}\n\n${rows}`
  }

  return message + printCommands()
}

const projects = () => {
  const history = readHistory({ silent: false })
  const projectBuilds = groupBuildsBy(history, 'p')

  let message = `${Bright('Box CI History')}: Builds grouped by project (${printNumber(Object.keys(projectBuilds), 'project')}, ${printNumber(history.builds, 'build')})` // prettier-ignore

  if (history.builds.length > 0) {
    Object.keys(projectBuilds).forEach((projectId) => {
      const { header, rows } = formatAsTable({
        columns: [
          {
            label: 'Build ID',
            field: 'id',
          },
          {
            label: 'Agent',
            field: 'a',
          },
          {
            label: 'Started',
            field: 't',
          },
        ],
        rows: projectBuilds[projectId].map((build) => ({
          id: build.id,
          a: build.a,
          t: formattedTime(build.t),
        })),
        tableIndent: '│ ',
      })

      message += `\n\n│ ${Bright(`Project ${projectId}`)} (${printNumber(projectBuilds[projectId], 'build')})\n│\n${header}\n│\n${rows}` // prettier-ignore
    })
  }

  return message + printCommands()
}

const agents = () => {
  const history = readHistory({ silent: false })
  const agentBuilds = groupBuildsBy(history, 'a')

  let message = `${Bright('Box CI History')}: Builds grouped by agent (${printNumber(Object.keys(agentBuilds), 'agent')}, ${printNumber(history.builds, 'build')})` // prettier-ignore

  if (history.builds.length > 0) {
    Object.keys(agentBuilds).forEach((agentName) => {
      const { header, rows } = formatAsTable({
        columns: [
          {
            label: 'Build ID',
            field: 'id',
          },
          {
            label: 'Project',
            field: 'p',
          },
          {
            label: 'Started',
            field: 't',
          },
        ],
        rows: agentBuilds[agentName].map((build) => ({
          id: build.id,
          p: build.p,
          t: formattedTime(build.t),
        })),
        tableIndent: '│ ',
      })

      message += `\n\n│ ${Bright(agentName)} (${printNumber(agentBuilds[agentName], 'build')})\n│\n${header}\n│\n${rows}` // prettier-ignore
    })
  }

  return message + printCommands()
}

const printHistory = (mode: HistoryCommandMode) => {
  switch (mode) {
    case 'full':
      return full()
    case 'builds':
      return builds()
    case 'builds-by-project':
      return projects()
    case 'builds-by-agent':
      return agents()

    default: {
      let x: never = mode

      return x
    }
  }
}

export default ({
  cli,
  commandMatched,
}: {
  cli: Command
  commandMatched: () => void
}) => {
  cli
    .command('history [mode]')

    // optional options
    .option('-l, --latest <arg>')

    .action(
      (
        mode: 'builds' | 'projects' | 'agents' | undefined,
        options: {
          latest: string
        },
      ) => {
        commandMatched()
        console.log('')

        const args = validateArgs({
          modeArgument: mode,
          options,
        })

        console.log(printHistory(args.mode))
        console.log('\n')
      },
    )
}
