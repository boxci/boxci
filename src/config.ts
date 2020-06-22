import fs from 'fs'
import { parse as parseYml } from 'yamljs'
import { Yellow } from './consoleFonts'
import { readFile } from './util'
import { printErrorAndExit } from './logging'
import { randomId } from './util'

export type ProjectBuildLabel = {
  name: string
  value: string
}

// a type which just matches the agent config properties
// relevant to logging, this is convenient to have the
// logging functions accept AgentConfig but also be able
// to call them directly with hardcoded values for the
// properties actually used without having to create an
// entire AgentConfig object with other irrelevant properties
// filled in with placeholder values
export type AgentConfigLoggingPartial = {
  silent?: boolean
}

export type AgentConfig = {
  // required
  projectId: string
  key: string

  // optional
  silent: boolean
  machineName?: string
  sshHost?: string

  // generated
  agentName: string

  // not in public API
  service: string
  usingTestService?: boolean
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

const readConfigFile = ({
  cwd,
}: {
  cwd: string
}): {
  configFromFile?: ProjectBuildConfig
  configFileName?: string
  configFileError?: string
} => {
  const configFileJsonExists =
    fs.existsSync(`${cwd}/${DEFAULTS.configFileJson}`) ? 1 : 0 // prettier-ignore
  const configFileYmlExists =
    fs.existsSync(`${cwd}/${DEFAULTS.configFileYml}`) ? 1 : 0 // prettier-ignore
  const configFileYamlExists =
    fs.existsSync(`${cwd}/${DEFAULTS.configFileYaml}`) ? 1 : 0 // prettier-ignore

  // if more than one config file is present, throw an error
  if (configFileJsonExists + configFileYmlExists + configFileYamlExists > 1) {
    return {
      configFileError:
        `Multiple config files found, please use a single config file: ` +
        (configFileJsonExists ? `\n  - ${DEFAULTS.configFileJson}` : '') +
        (configFileYmlExists ? `\n  - ${DEFAULTS.configFileYml}` : '') +
        (configFileYamlExists ? `\n  - ${DEFAULTS.configFileYaml}` : ''),
    }
  }

  // if no config file is present, throw an error
  if (configFileJsonExists + configFileYmlExists + configFileYamlExists === 0) {
    return {
      configFileError:
        `No config file found, please use one of the following: ` +
        `\n  - ${DEFAULTS.configFileJson}` +
        `\n  - ${DEFAULTS.configFileYml}` +
        `\n  - ${DEFAULTS.configFileYaml}`,
    }
  }

  if (configFileJsonExists) {
    try {
      return {
        configFromFile: JSON.parse(
          readFile(`${cwd}/${DEFAULTS.configFileJson}`),
        ),
        configFileName: DEFAULTS.configFileJson,
      }
    } catch (err) {
      return {
        configFileError: `Could not read config file ${DEFAULTS.configFileJson}\n\nCause:\n\n${err}\n\n`,
      }
    }
  } else if (configFileYmlExists) {
    try {
      return {
        configFromFile: parseYml(readFile(`${cwd}/${DEFAULTS.configFileYml}`)) as ProjectBuildConfig, // prettier-ignore
        configFileName: DEFAULTS.configFileYml,
      }
    } catch (err) {
      return {
        configFileError: `Could not read config file ${DEFAULTS.configFileYml}\n\nCause:\n\n${err}\n\n`,
      }
    }
  } else if (configFileYamlExists) {
    try {
      return {
        configFromFile:  parseYml(readFile(`${cwd}/${DEFAULTS.configFileYaml}`)) as ProjectBuildConfig, // prettier-ignore
        configFileName: DEFAULTS.configFileYaml,
      }
    } catch (err) {
      return {
        configFileError: `Could not read config file ${DEFAULTS.configFileYaml}\n\nCause:\n\n${err}\n\n`,
      }
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

export const readProjectBuildConfig = ({
  dir,
}: {
  dir: string
}): {
  projectBuildConfig?: ProjectBuildConfig
  configFileName?: string
  validationErrors?: Array<string>
  configFileError?: string
} => {
  const { configFromFile, configFileName, configFileError } = readConfigFile({
    cwd: dir,
  })

  if (
    configFileError ||
    configFromFile === undefined ||
    configFileName === undefined
  ) {
    return { configFileError }
  }

  const { tasks, pipelines } = configFromFile

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
    // check pipeline definitions are valid
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

  return {
    projectBuildConfig: {
      tasks,
      pipelines,
    },
    configFileName,
    ...(validationErrors.length > 0 && { validationErrors }),
  }
}

const generateAgentName = () =>
  `agent-${randomId(3)}-${randomId(3)}-${randomId(3)}-${randomId(3)}`

const MACHINE_NAME_MAX_LENGTH = 32

export type AgentCommandCliOptions = {
  project: string
  key: string
  machine?: string
  sshHost?: string
  silent?: boolean
}

export const getAgentConfig = ({
  options,
}: {
  options: AgentCommandCliOptions
}): AgentConfig => {
  // required
  const projectId = options.project ?? process.env.BOXCI_PROJECT
  const key = options.key ?? process.env.BOXCI_KEY

  const validationErrors: string[] = []

  if (projectId === undefined) {
    validationErrors.push(`  - ${Yellow('project')} is required`) // prettier-ignore
  } else if (
    typeof projectId !== 'string' ||
    projectId.charAt(0) !== 'P' ||
    projectId.length !== 8
  ) {
    validationErrors.push(`  - ${Yellow('project')} must be 8 characters long and start with P`) // prettier-ignore
  }

  if (key === undefined) {
    validationErrors.push(`  - ${Yellow('key')} is required`) // prettier-ignore
  }

  // optional
  let machineName = options.machine || process.env.BOXCI_MACHINE

  if (machineName !== undefined) {
    machineName = '' + machineName // convert to string

    if (machineName.length > MACHINE_NAME_MAX_LENGTH) {
      validationErrors.push(`  - ${Yellow('machine')} cannot be longer than ${MACHINE_NAME_MAX_LENGTH} characters`) // prettier-ignore
    }
  }

  // no validation on ssh host, just use whatever provided, if it works it works
  const sshHost = options.sshHost

  const silent = !!(options.silent ?? process.env.BOXCI_SILENT === 'true')

  if (validationErrors.length > 0) {
    printErrorAndExit({ silent }, validationErrors.join('\n'))
  }

  // generated
  const agentName = generateAgentName()

  // not in public API
  const testService = process.env.BOXCI___TS
  const service = testService ?? DEFAULTS.service

  return {
    projectId,
    key,
    silent,
    agentName,
    machineName,
    service,
    ...(sshHost !== undefined && { sshHost }),
    ...(testService !== undefined && { usingTestService: true }),
  }
}
