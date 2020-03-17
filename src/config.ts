import { Command } from 'commander'
import fs from 'fs'
import { parse as parseYml } from 'yamljs'
import { Yellow, Bright } from './consoleFonts'
import { readFile } from './util'
import { printErrorAndExit } from './logging'
import Spinner from './Spinner'
import { randomId } from './util'

export type ProjectBuildLabel = {
  name: string
  value: string
}

type ProjectConfigFromConfigFile = {
  project: string
  key: string

  // not in public API - just for test purposes
  service?: string
}

type ProjectConfigFromAgentPartial = {
  agentName?: string
  noSpinners?: boolean

  // not in public API - just for test purposes
  retries?: string
  service?: string
}

type ProjectConfigFromMachine = {
  agentName: string
  spinnersEnabled: boolean

  // not in public API - just for test purposes
  retries: number
  service?: string
}

export type ProjectConfig = {
  // required project level configs
  projectId: string
  accessKey: string

  // optional machine level configs
  retries: number
  agentName: string
  spinnersEnabled: boolean

  // not in public API - just for test purposes
  service: string
}

export type ProjectBuildConfig = {
  tasks: { [name: string]: string }
  pipelines: { [name: string]: string[] }
}

const DEFAULTS = {
  configFileJson: 'boxci.json',
  configFileYml: 'boxci.yml',
  configFileYaml: 'boxci.yaml',
  service: 'https://boxci.dev',
}

const isObject = (candidate: any): boolean =>
  typeof candidate === 'object' && candidate !== null

const isEmpty = (candidate: any): boolean => {
  for (let key in candidate) {
    if (Object.prototype.hasOwnProperty.call(candidate, key)) {
      return false
    }
  }

  return true
}

const isMapOfStringToString = (candidate: any): boolean => {
  for (let key in candidate) {
    if (
      Object.prototype.hasOwnProperty.call(candidate, key) &&
      (typeof key !== 'string' || typeof candidate[key] !== 'string')
    ) {
      return false
    }
  }

  return true
}

const isArrayOfStrings = (candidate: any[]) => {
  for (let item of candidate) {
    if (typeof item !== 'string') {
      return false
    }
  }

  return true
}

const readConfigFile = (
  cwd: string,
  spinner?: Spinner,
): [ProjectConfigFromConfigFile | ProjectBuildConfig, string] => {
  const configFileJsonExists =
    fs.existsSync(`${cwd}/${DEFAULTS.configFileJson}`) ? 1 : 0 // prettier-ignore
  const configFileYmlExists =
    fs.existsSync(`${cwd}/${DEFAULTS.configFileYml}`) ? 1 : 0 // prettier-ignore
  const configFileYamlExists =
    fs.existsSync(`${cwd}/${DEFAULTS.configFileYaml}`) ? 1 : 0 // prettier-ignore

  // if more than one config file is present, throw an error
  if (configFileJsonExists + configFileYmlExists + configFileYamlExists > 1) {
    return printErrorAndExit(
      `Multiple config files found, please use a single file: ` +
        (configFileJsonExists ? `\n  - ${DEFAULTS.configFileJson}` : '') +
        (configFileYmlExists ? `\n  - ${DEFAULTS.configFileYml}` : '') +
        (configFileYamlExists ? `\n  - ${DEFAULTS.configFileYaml}` : ''),
      spinner,
    )
  }

  // if no config file is present, throw an error
  if (configFileJsonExists + configFileYmlExists + configFileYamlExists === 0) {
    return printErrorAndExit(
      `No config file found, please use one of the following: ` +
        `\n  - ${DEFAULTS.configFileJson}` +
        `\n  - ${DEFAULTS.configFileYml}` +
        `\n  - ${DEFAULTS.configFileYaml}`,
      spinner,
    )
  }

  if (configFileJsonExists) {
    try {
      return [
        JSON.parse(readFile(`${cwd}/${DEFAULTS.configFileJson}`)),
        DEFAULTS.configFileJson,
      ]
    } catch {
      return printErrorAndExit(
        `Could not read config file ${DEFAULTS.configFileJson}`,
      )
    }
  } else if (configFileYmlExists) {
    try {
      return [
        parseYml(readFile(`${cwd}/${DEFAULTS.configFileYml}`)) as ProjectConfigFromConfigFile, // prettier-ignore
        DEFAULTS.configFileYml,
      ]
    } catch {
      return printErrorAndExit(
        `Could not read config file ${DEFAULTS.configFileYml}`,
      )
    }
  } else if (configFileYamlExists) {
    try {
      return [
        parseYml(readFile(`${cwd}/${DEFAULTS.configFileYaml}`)) as ProjectConfigFromConfigFile, // prettier-ignore
        DEFAULTS.configFileYaml,
      ]
    } catch {
      return printErrorAndExit(
        `Could not read config file ${DEFAULTS.configFileYaml}`,
      )
    }
  }

  // this can never happen
  return undefined as never
}

const prettyPrintConfigObjectInError = (object: any) => {
  const padding = '  ' // 2 spaces
  const prettyPrinted = JSON.stringify(object, null, 2)
  return padding + prettyPrinted.split('\n').join('\n' + padding)
}

export const readProjectBuildConfig = (
  dir: string,
  commit: string,
  spinner: Spinner,
): ProjectBuildConfig => {
  const [{ tasks, pipelines }, configFileName] = readConfigFile(
    dir,
    spinner,
  ) as [ProjectBuildConfig, string]

  // do immediate validation on the config file options at this commit
  const validationErrors: Array<string> = []

  if (!tasks) {
    if (tasks === undefined) {
      validationErrors.push(`  - ${Yellow('tasks')} not set`)
    }
  } else if (!isObject(tasks)) {
    validationErrors.push(`  - ${Yellow('tasks')} must be a map of task name to command. You provided: ${tasks}`) // prettier-ignore
  } else if (isEmpty(tasks)) {
    validationErrors.push(`  - ${Yellow('tasks')} cannot be empty. You must specify at least one task.`) // prettier-ignore
  } else if (!isMapOfStringToString(tasks)) {
    validationErrors.push(`  - ${Yellow('tasks')} must be a map of string names to string commands. You provided:\n\n${prettyPrintConfigObjectInError(tasks)}\n\n`) // prettier-ignore
  }

  if (!pipelines) {
    if (pipelines === undefined) {
      validationErrors.push(`  - ${Yellow('pipelines')} not set`)
    }
  } else if (!isObject(pipelines)) {
    validationErrors.push(`  - ${Yellow('pipelines')} must be a map of pipeline name to array of tasks. You provided: ${tasks}`) // prettier-ignore
  } else if (isEmpty(pipelines)) {
    validationErrors.push(`  - ${Yellow('pipelines')} cannot be empty. You must specify at least one pipeline.`) // prettier-ignore
  } else {
    // check pipeline definitions is valid
    for (let key in pipelines) {
      if (
        Object.prototype.hasOwnProperty.call(pipelines, key) &&
        (typeof key !== 'string' ||
          !Array.isArray(pipelines[key]) ||
          !isArrayOfStrings(pipelines[key]))
      ) {
        validationErrors.push(`  - ${Yellow('pipelines')} must be a map of string name to array of string task names. You provided:\n\n${prettyPrintConfigObjectInError(pipelines)}\n\n`) // prettier-ignore
      }
    }

    // check all provided task names are defined tasks
    const undefinedTaskErrors: Array<{
      pipeline: string
      undefinedTasks: string[]
    }> = []
    for (let key in pipelines) {
      if (Object.prototype.hasOwnProperty.call(pipelines, key)) {
        const pipelineUndefinedTasks: string[] = []
        for (let task of pipelines[key]) {
          if (tasks[task] === undefined) {
            pipelineUndefinedTasks.push(task)
          }
        }

        if (pipelineUndefinedTasks.length > 0) {
          undefinedTaskErrors.push({
            pipeline: key,
            undefinedTasks: pipelineUndefinedTasks,
          })
        }
      }
    }

    if (undefinedTaskErrors.length > 0) {
      let undefinedTaskErrorsMessage = `  - ${Yellow('pipelines')} contains tasks which are not defined in ${Yellow('tasks')}` // prettier-ignore

      for (let undefinedTaskError of undefinedTaskErrors) {
        undefinedTaskErrorsMessage += `\n    - pipeline '${undefinedTaskError.pipeline}' contains undefined tasks [ ${undefinedTaskError.undefinedTasks.join(', ')} ]` // prettier-ignore
      }

      validationErrors.push(undefinedTaskErrorsMessage)
    }
  }

  if (validationErrors.length > 0) {
    const errorMessage = validationErrors.join('\n')

    printErrorAndExit(
      `\n\n` +
        `${Bright(`Found the following config errors`)}\n` +
        `  - ${Yellow(`config file:`)}  ${configFileName}\n` +
        `  - ${Yellow(`commit:`)}       ${commit}\n\n` +
        `${errorMessage}\n\n` +
        `Run ${Yellow('boxci docs')} for more info on config options\n\n`,
      spinner,
    )
  }

  return {
    tasks,
    pipelines,
  }
}

const readProjectConfigFile = (
  dir: string,
  spinner?: Spinner,
): ProjectConfigFromConfigFile => {
  let [{ project, key, service }, configFileName] = readConfigFile(
    dir,
    spinner,
  ) as [ProjectConfigFromConfigFile, string]

  // do immediate validation on the config file options
  const validationErrors: Array<string> = []

  if (!project) {
    if (project === undefined) {
      validationErrors.push(`  - ${Yellow('project')} not set`)
    } else {
      validationErrors.push(`  - ${Yellow('project')} is empty`)
    }
  } else if (typeof project !== 'string') {
    validationErrors.push(`  - ${Yellow('project')} must be a string. You provided: ${project}`) // prettier-ignore
  } else if (project.length !== 8) {
    validationErrors.push(`  - ${Yellow('project')} must be 8 characters. You provided: ${project}`) // prettier-ignore
  }

  // key is a special case
  // it doesn't have to be provided in the config file, it can also be provided
  // as an env var, so check for this first in case it is missing

  const keyPresentInConfigFile = key !== undefined

  if (!keyPresentInConfigFile) {
    key = process.env.BOXCI_KEY as string
  }

  if (!key) {
    if (key === undefined) {
      validationErrors.push(`  - ${Yellow('key')} not set`)
    } else {
      validationErrors.push(`  - ${Yellow('key')} is empty`)
    }
  } else if (typeof key !== 'string') {
    validationErrors.push(`  - ${Yellow('key')} must be a string. You provided [${key}]`) // prettier-ignore
  } else if (key.length !== 32) {
    validationErrors.push(`  - ${Yellow('key')} must be 32 characters. You provided [${key}]`) // prettier-ignore
  }

  if (validationErrors.length > 0) {
    const errorMessage = validationErrors.join('\n')

    printErrorAndExit(
      `\n\n${Bright(`Found the following config errors in ${configFileName}`)}\n\n` + // prettier-ignore
        `${errorMessage}\n\n` +
        `Run ${Yellow('boxci docs')} for more info on config options\n\n`,
      spinner,
    )
  }

  return {
    project,
    key,
    service,
  }
}

const buildAgentConfigFromPossiblyMissingConfigs = (
  retries: string | undefined,
  agentName: string | undefined,
  service: string | undefined,
) => ({
  ...(retries && { retries }),
  ...(agentName && { agentName }),
  ...(service && { service }),
})

const readFromCliOptions = (cli: Command): ProjectConfigFromAgentPartial =>
  buildAgentConfigFromPossiblyMissingConfigs(
    cli.retries,
    cli.agentName,
    cli.service,
  )

const readFromEnvVars = (): ProjectConfigFromAgentPartial =>
  buildAgentConfigFromPossiblyMissingConfigs(
    process.env.BOXCI_RETRIES,
    process.env.BOXCI_AGENT_NAME,
    process.env.BOXCI_TEST_SERVICE,
  )

const generateRandomAgentName = () =>
  `agent-${randomId(3)}-${randomId(3)}-${randomId(3)}`

const getMachineConfig = (cli: Command): ProjectConfigFromMachine => {
  let { retries, agentName, service, noSpinners } = {
    ...readFromCliOptions(cli),
    ...readFromEnvVars(), // env vars take priority
  }

  // validate provided values
  const validationErrors = []

  let parsedRetries

  if (retries !== undefined) {
    try {
      parsedRetries = parseInt(retries as string)

      if (parsedRetries < 0 || parsedRetries > 100) {
        validationErrors.push(`  - ${Yellow('retries')} must be in range 0-100, you provided [${retries}]`) // prettier-ignore
      }
    } catch {
      validationErrors.push(`  - ${Yellow('retries')} must be a number in range 0-100, you provided [${retries}]`) // prettier-ignore
    }
  }

  if (agentName !== undefined) {
    if (agentName.length > 64) {
      validationErrors.push(`- ${Yellow('agentName')} has max length 64 chars, you provided [${agentName}] (${agentName.length} chars)`) // prettier-ignore
    } else if (agentName.length === 0) {
      validationErrors.push(`- ${Yellow('agentName')} cannot be empty. If you don't want to provide a value, just don't configure it`) // prettier-ignore
    }
  }

  if (validationErrors.length > 0) {
    printErrorAndExit(validationErrors.join('\n'))
  }

  return {
    agentName: agentName || generateRandomAgentName(),
    spinnersEnabled: !noSpinners, // defaults to true, only false is noSpinners flag set

    // not in public API, just for test purposes
    retries: parsedRetries || 10, // default 10 if not provided
    service,
  }
}

export const getProjectConfig = (
  cli: Command,
  repoRootDir: string,
  spinner?: Spinner,
): ProjectConfig => {
  const configFromConfigFile = readProjectConfigFile(repoRootDir, spinner)
  const configFromMachine = getMachineConfig(cli)

  // for the service flag
  // order of preference is env vars > cli option > config file
  //
  // NOTE this is not part of the public API, it's only used for testing the CLI
  // against a test service instead of the production service
  const service =
    configFromMachine.service ||
    configFromConfigFile.service ||
    DEFAULTS.service

  const projectConfig: ProjectConfig = {
    projectId: configFromConfigFile.project,
    accessKey: configFromConfigFile.key,
    agentName: configFromMachine.agentName,
    spinnersEnabled: configFromMachine.spinnersEnabled,

    // optionals
    retries: configFromMachine.retries,

    // not part of the public API, just for test purposes
    service,
  }

  // log('INFO', () => `CLI config options:\n\n${JSON.stringify(config, null, 2)}\n\n`) // prettier-ignore

  return projectConfig
}
