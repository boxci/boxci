import { Yellow, Bright } from './consoleFonts'
import {
  BoxCIHistory,
  BuildMeta,
  readHistory,
  getBoxCiDir,
  paths,
  filenameUtils,
} from './data2'
import { printErrorAndExit, formattedStartTime } from './logging'

export type HistoryCommandArgs = {
  latest: number
  mode: HistoryCommandMode
  agentName?: string
}

export type CleanHistoryCommandArgs = {
  dryRun: boolean
  hardDelete: boolean
  agentName?: string
  buildId?: string
}

type HistoryCommandMode =
  | 'full'
  | 'builds'
  | 'builds-by-project'
  | 'builds-by-agent'

const HISTORY_COMMAND_LAST_OPTION_DEFAULT = '10'

const validateArgs = ({
  agent,
  options,
}: {
  agent: string | undefined
  options: {
    latest: string
    builds: boolean
    agents: boolean
    projects: boolean
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

  if (agent !== undefined) {
    agent = agent + '' // convert to string

    if (agent.length > 32) {
      validationErrors.push(`  - ${Yellow('agent name')} (1st argument) cannot be longer than 32 characters`) // prettier-ignore
    }
  }

  if (validationErrors.length > 0) {
    printErrorAndExit(validationErrors.join('\n'))
  }

  const mode: HistoryCommandMode = options.builds
    ? 'builds'
    : options.projects
    ? 'builds-by-project'
    : options.agents
    ? 'builds-by-agent'
    : 'full'

  return {
    latest,
    mode,
    ...(agent !== undefined && { agentName: agent }),
  }
}

const getProjectBuilds = (history: BoxCIHistory) => {
  // group builds by project
  //
  // the builds are already sorted by start time (latest first)
  // so will be sorted by start time in these groups as well
  const projectBuilds: { [projectId: string]: BuildMeta[] } = {}
  history.builds.forEach((buildMeta) => {
    if (!projectBuilds[buildMeta.p]) {
      projectBuilds[buildMeta.p] = []
    }

    projectBuilds[buildMeta.p].push(buildMeta)
  })

  return projectBuilds
}

const padRight = (str: string, length: number) => {
  const buffer = Array(length + 1).join(' ')

  return (str + buffer).substring(0, buffer.length)
}

const printAsTable = ({
  rows,
  columns,
  columnPaddingSpaces,
}: {
  rows: Array<{ [key: string]: string }>
  columns: Array<{ label: string; field: string }>
  columnPaddingSpaces: number
}) => {
  const columnFormatting: { [key: string]: { maxLength: number } } = {}

  columns.forEach(({ field }) => {
    let maxLength = 0

    rows.forEach((row) => {
      maxLength = Math.max(row[field].length, maxLength)
    })

    columnFormatting[field] = { maxLength }
  })

  let output = ''

  // header row
  columns.forEach(({ field, label }) => {
    output += padRight(label, columnFormatting[field].maxLength + columnPaddingSpaces) // prettier-ignore
  })

  // rows
  output += '\n'
  rows.forEach((row) => {
    output += '\n'
    columns.forEach(({ field }) => {
      output += `${padRight(row[field], columnFormatting[field].maxLength + columnPaddingSpaces)}` // prettier-ignore
    })
  })

  return output
}

const BUILD_TABLE_COLUMNS = [
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
]

const builds = () => {
  const history = readHistory()

  let message = `${Bright('Box CI History')}: Builds (${history.builds.length})` // prettier-ignore

  if (history.builds.length > 0) {
    message += '\n\n'
    message += printAsTable({
      rows: history.builds.map((build) => ({
        id: build.id,
        p: build.p,
        a: build.a,
        t: formattedStartTime(build.t),
      })),
      columns: BUILD_TABLE_COLUMNS,
      columnPaddingSpaces: 3,
    })
  }

  return message + printCommands()
}

const printCommands = () =>
  // prettier-ignore
  `\n\n∙ Usage\n\n` +
  `  ${Yellow('boxci history')}             overview\n` +
  `  ${Yellow('boxci history --builds')}    list builds\n` +
  `  ${Yellow('boxci history --projects')}  list builds grouped by project\n` +
  `  ${Yellow('boxci history --agents')}    list builds grouped by agent`

const full = () => {
  const history = readHistory()
  const projectBuilds = getProjectBuilds(history)
  const projectIds = Object.keys(projectBuilds)

  // prettier-ignore
  const message =
    `${Bright('Box CI History')}: Overview\n\n` +
    `${Bright('Builds')}     ${history.builds.length}\n` +
    `${Bright('Projects')}   ${projectIds.length}\n` +
    `${Bright('Agents')}     ${history.agents.length}`

  return message + printCommands()
}

const printHistory = (mode: HistoryCommandMode) => {
  switch (mode) {
    case 'full':
      return full()
    case 'builds':
      return builds()
    case 'builds-by-project':
    case 'builds-by-agent':
      return full()

    default: {
      let x: never = mode

      return x
    }
  }
}

export default {
  validateArgs,
  printHistory,
}
