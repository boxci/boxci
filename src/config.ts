import { Command } from 'commander'
import fs from 'fs'
import { parse as parseYml } from 'yamljs'
import { Yellow, Bright } from './consoleFonts'
import { readFile } from './util'
import { printErrorAndExit } from './logging'
import { Spinner } from './Spinner'

export type ProjectBuildLabel = {
  name: string
  value: string
}

type ProjectConfig = {
  command: string
  project: string
  key: string

  // not in public API - just for test purposes
  service?: string
}

type PartialMachineConfig = {
  machine?: string

  // not in public API - just for test purposes
  retries?: string
  service?: string
}

type MachineConfig = {
  machine: string

  // not in public API - just for test purposes
  retries: number
  service?: string
}

export type Config = {
  // required project level configs
  command: string
  projectId: string
  accessKey: string

  // optional machine level configs
  retries: number
  machineName: string

  // not in public API - just for test purposes
  service: string
}

const DEFAULTS = {
  configFileJson: 'boxci.json',
  configFileYml: 'boxci.yml',
  configFileYaml: 'boxci.yaml',
}

const readConfigFile = (
  cwd: string,
  spinner?: Spinner,
): [ProjectConfig, string] => {
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
        parseYml(readFile(`${cwd}/${DEFAULTS.configFileYml}`)) as ProjectConfig,
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
        parseYml(
          readFile(`${cwd}/${DEFAULTS.configFileYaml}`),
        ) as ProjectConfig,
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

export const readCommandFromConfigFile = (
  dir: string,
  commit: string,
  spinner: Spinner,
): string => {
  const [{ command }, configFileName] = readConfigFile(dir, spinner)

  if (!command) {
    printErrorAndExit(
      `Could not find ${Yellow('command')} ` +
        `in ${configFileName} at commit ${Yellow(commit)}`,
    )
  }

  return command
}

const readFromConfigFile = (dir: string, spinner?: Spinner): ProjectConfig => {
  let [{ command, project, key, service }, configFileName] = readConfigFile(
    dir,
    spinner,
  )

  // do immediate validation on the config file options
  const validationErrors: Array<string> = []

  if (!command) {
    if (command === undefined) {
      validationErrors.push(`  - ${Yellow('command')} not set`)
    } else {
      validationErrors.push(`  - ${Yellow('command')} is empty`)
    }
  } else if (typeof command !== 'string') {
    validationErrors.push(`  - ${Yellow('command')} must be a string. You provided [${command}]`) // prettier-ignore
  }

  if (!project) {
    if (project === undefined) {
      validationErrors.push(`  - ${Yellow('project')} not set`)
    } else {
      validationErrors.push(`  - ${Yellow('project')} is empty`)
    }
  } else if (typeof project !== 'string') {
    validationErrors.push(`  - ${Yellow('project')} must be a string. You provided [${project}]`) // prettier-ignore
  } else if (project.length !== 8) {
    validationErrors.push(`  - ${Yellow('project')} must be 8 characters. You provided [${project}]`) // prettier-ignore
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
    command,
    project,
    key,
    service,
  }
}

const buildMachineConfigFromPossiblyMissingConfigs = (
  retries: string | undefined,
  machine: string | undefined,
  service: string | undefined,
) => ({
  ...(retries && { retries }),
  ...(machine && { machine }),
  ...(service && { service }),
})

const readFromCliOptions = (cli: Command): PartialMachineConfig =>
  buildMachineConfigFromPossiblyMissingConfigs(
    cli.retries,
    cli.machine,
    cli.service,
  )

const readFromEnvVars = (): PartialMachineConfig =>
  buildMachineConfigFromPossiblyMissingConfigs(
    process.env.BOXCI_RETRIES,
    process.env.BOXCI_MACHINE,
    process.env.BOXCI_TEST_SERVICE,
  )

const getMachineConfig = (cli: Command): MachineConfig => {
  let { retries, machine, service } = {
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

  if (machine !== undefined) {
    if (machine.length > 64) {
      validationErrors.push(`- ${Yellow('machine')} has max length 64 chars, you provided [${machine}] (${machine.length} chars)`) // prettier-ignore
    } else if (machine.length === 0) {
      validationErrors.push(`- ${Yellow('machine')} cannot be empty. If you don't want to provide a value, just don't configure it`) // prettier-ignore
    }
  }

  if (validationErrors.length > 0) {
    printErrorAndExit(validationErrors.join('\n'))
  }

  return {
    machine: machine || '', // '' is the marker for 'not set'

    // not in public API, just for test purposes
    retries: parsedRetries || 10, // default 10 if not provided
    service,
  }
}

const get = (cli: Command, repoRootDir: string, spinner?: Spinner): Config => {
  const projectConfig = readFromConfigFile(repoRootDir, spinner)

  const machineConfig = getMachineConfig(cli)

  // for the service flag
  // order of preference is env vars > cli option > config file
  //
  // NOTE this is not part of the public API, it's only used for testing the CLI
  // against a test service instead of the production service
  const service =
    machineConfig.service || projectConfig.service || 'https://boxci.dev'

  const config = {
    command: projectConfig.command,
    projectId: projectConfig.project,
    accessKey: projectConfig.key,

    // optionals
    retries: machineConfig.retries,
    machineName: machineConfig.machine,

    // not part of the public API, just for test purposes
    service,
  }

  // log('INFO', () => `CLI config options:\n\n${JSON.stringify(config, null, 2)}\n\n`) // prettier-ignore

  return config
}

export default get
