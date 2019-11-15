import { Command } from 'commander'
import fs from 'fs'
import yaml from 'js-yaml'
import { Yellow, Bright } from './consoleFonts'

export type ProjectBuildLabel = {
  name: string
  value: string
}

type ProvidedConfigValues = {
  project?: string
  key?: string
  retries?: string
  machine?: string
}

export type Config = {
  projectId: string
  accessKey: string
  retries: number
  machineName: string

  // not in public API - for test purposes only
  //service: string
}

const DEFAULTS = {
  configFileJson: 'boxci.json',
  configFileYml: 'boxci.yml',
  configFileYaml: 'boxci.yaml',
}

const configError = (message: string) => {
  // prettier-ignore
  console.log(`\n\n${Bright(`Error in config`)}\n\n${message}\n\nRun ${Yellow('boxci --help')} for info on config options\n\n`)

  process.exit(1)
}

const readFile = (path: string) => fs.readFileSync(path, 'utf-8')

const parseJsonFile = (path: string) => JSON.parse(readFile(path))

const parseYmlFile = (path: string) => yaml.safeLoad(readFile(path))

const readConfigFile = (cli: Command, cwd: string): Config | undefined => {
  let configFilePath

  if (cli.config) {
    // if --config option passed, use that instead of default
    configFilePath = cli.config

    // validate --config option
    if (!configFilePath) {
      console.log(
        `--config must be a path to a config file\n\nYou provided no value`,
      )

      process.exit(1)
    }

    // validate --config option
    if (typeof configFilePath !== 'string') {
      console.log(
        `--config must be a path to a config file\n\nYou provided the value [${configFilePath}]`,
      )

      process.exit(1)
    }

    // if --config file doesn't exist, throw error
    if (!fs.existsSync(cli.config)) {
      console.log(`--config file not found at [${cli.config}]`)

      process.exit(1)
    }

    if (configFilePath.toLowerCase().endsWith('.json')) {
      try {
        return parseJsonFile(configFilePath)
      } catch {
        configError(
          `Could not parse --config file ${configFilePath}\n\nPlease ensure it contains valid JSON`,
        )
      }
    } else if (
      configFilePath.toLowerCase().endsWith('.yml') ||
      configFilePath.toLowerCase().endsWith('.yaml')
    ) {
      try {
        return parseYmlFile(configFilePath)
      } catch {
        configError(
          `Could not parse --config file ${configFilePath}\n\nPlease ensure it contains valid YAML`,
        )
      }
    } else {
      configError(
        `--config file format must be JSON or YAML\n\nYou provided ${configFilePath}`,
      )
    }
  } else {
    // if no --config option, look for default config file names
    const configFileJsonExists = fs.existsSync(
      `${cwd}/${DEFAULTS.configFileJson}`,
    )
      ? 1
      : 0

    const configFileYmlExists = fs.existsSync(
      `${cwd}/${DEFAULTS.configFileYml}`,
    )
      ? 1
      : 0

    const configFileYamlExists = fs.existsSync(
      `${cwd}/${DEFAULTS.configFileYaml}`,
    )
      ? 1
      : 0

    // if more than one default config file is present, throw an error
    if (configFileJsonExists + configFileYmlExists + configFileYamlExists > 1) {
      configError(
        `Multiple config files found, please use a single file: ` +
          (configFileJsonExists ? `\n  -${DEFAULTS.configFileJson}` : '') +
          (configFileYmlExists ? `\n  -${DEFAULTS.configFileYml}` : '') +
          (configFileYamlExists ? `\n  -${DEFAULTS.configFileYaml}` : ''),
      )
    }

    if (configFileJsonExists) {
      return parseJsonFile(`${cwd}/${DEFAULTS.configFileJson}`)
    } else if (configFileYmlExists) {
      return parseJsonFile(`${cwd}/${DEFAULTS.configFileYml}`)
    } else if (configFileYamlExists) {
      return parseJsonFile(`${cwd}/${DEFAULTS.configFileYaml}`)
    }
  }
}

const readFromConfigFile = (
  cli: Command,
  cwd: string,
): ProvidedConfigValues => {
  const config: any = readConfigFile(cli, cwd)

  return {
    ...(config.project && { project: config.project }),
    ...(config.key && { key: config.key }),
    ...(config.retries && { retries: config.retries }),
    ...(config.machine && { machine: config.machine }),
  }
}

const readFromEnvVars = (): ProvidedConfigValues => {
  const project = process.env.BOXCI_PROJECT
  const key = process.env.BOXCI_KEY
  const retries = process.env.BOXCI_RETRIES
  const machine = process.env.BOXCI_MACHINE

  return {
    ...(project && { project }),
    ...(key && { key }),
    ...(retries && { retries }),
    ...(machine && { machine }),
  }
}

// basically just picks the config from cli, to ensure nothing irrelevant gets through
const readFromCliOptions = (cli: Command): ProvidedConfigValues => ({
  ...(cli.project && { project: cli.project }),
  ...(cli.key && { key: cli.key }),
  ...(cli.retries && { retries: cli.retries }),
  ...(cli.machine && { machine: cli.machine }),
})

const get = (cli: Command, cwd: string): Config => {
  // get provided config from various sources, listed in reverse order of preference here
  const providedConfig: ProvidedConfigValues = {
    ...readFromConfigFile(cli, cwd), // use config file third
    ...readFromCliOptions(cli), // use cli options second
    ...readFromEnvVars(), // use env vars first
  }

  // validate provided values
  const validationErrors = []

  const projectId = providedConfig.project
  const accessKey = providedConfig.key

  if (!projectId) {
    validationErrors.push(`  - ${Yellow('project')} not set`)
  } else if (typeof projectId !== 'string') {
    validationErrors.push(
      `  - ${Yellow('project')} must be a string. You provided [${projectId}]`,
    )
  }

  if (!accessKey) {
    validationErrors.push(`  - ${Yellow('key')} not set`)
  } else if (typeof accessKey !== 'string') {
    validationErrors.push(
      `  - ${Yellow('key')} must be a string. You provided [${accessKey}]`,
    )
  }

  let retries = 10

  if (providedConfig.retries !== undefined) {
    if (!providedConfig.retries) {
      // prettier-ignore
      validationErrors.push(
        `  - ${Yellow('retries')} must be a number in range 0-100, you provided no value`,
      )
    } else {
      if (typeof providedConfig.retries === 'number') {
        retries = providedConfig.retries

        if (retries < 0 || retries > 100) {
          // prettier-ignore
          validationErrors.push(
            `  - ${Yellow('retries')} must be in range 0-100, you provided [${retries}]`,
          )
        }
      } else if (typeof providedConfig.retries === 'string') {
        try {
          retries = parseInt(providedConfig.retries)

          if (retries < 0 || retries > 100) {
            // prettier-ignore
            validationErrors.push(
              `  - ${Yellow('retries')} must be in range 0-100, you provided [${retries}]`,
            )
          }
        } catch {
          // prettier-ignore
          validationErrors.push(
            `  - ${Yellow('retries')} must be a number in range 0-100, you provided [${providedConfig.retries}]`,
          )
        }
      } else {
        // prettier-ignore
        validationErrors.push(
          `  - ${Yellow('retries')} must be a number in range 0-100, you provided ${providedConfig.retries}`,
        )
      }
    }
  }

  let machineName = providedConfig.machine

  if (machineName !== undefined) {
    if (typeof machineName !== 'string') {
      // prettier-ignore
      validationErrors.push(
        `- ${Yellow('machine')} must be a string, you provided [${machineName}]`,
      )
    } else {
      // prettier-ignore
      if (machineName.length > 64) {
        validationErrors.push(
          `- ${Yellow('machine')} has max length 64 chars, you provided [${machineName}] which is ${machineName.length} chars`
        )
      } else if (machineName.length === 0) {
        // prettier-ignore
        validationErrors.push(
          `- ${Yellow('machine')} cannot be the empty. If you don't want to set a value for ${Yellow('machine')}, just don't include it in your config`
        )
      }
    }
  }

  if (validationErrors.length > 0) {
    configError(validationErrors.join('\n'))
  }

  return {
    projectId: projectId!, // ! because we know this is defined because of validation above
    accessKey: accessKey!, // ! because we know this is defined because of validation above
    retries,
    machineName: machineName || '', // if machineName not provided, send empty string, which is the indicator of no value set (for this reason, config of machine as '' is invalid, because setting the empty string as an actual value won't behave as expected)
  }
}

export default get
