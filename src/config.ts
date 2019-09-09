import { Command } from 'commander'
import fs from 'fs'

export type ProjectBuildLabel = {
  name: string
  value: string
}

type ConfigWithPossiblyUndefinedValues = {
  projectId?: string
  accessKey?: string
  emojis?: boolean
  spinners?: boolean
  silent?: boolean
  service?: string
  retries?: number
  labels?: Array<ProjectBuildLabel>
}

export type Config = Required<ConfigWithPossiblyUndefinedValues>

const CONFIG_FILE_NAME_DEFAULT = 'boxci.json'

const getConfigFromFileIfExists = (
  cli: Command,
  cwd: string,
): ConfigWithPossiblyUndefinedValues => {
  let configFilePath

  if (cli.config) {
    configFilePath = cli.config

    if (!fs.existsSync(cli.config)) {
      throw new Error(
        `No config file exists at the path provided in the --config option: ${cli.config}`,
      )
    }
  } else {
    configFilePath = `${cwd}/${CONFIG_FILE_NAME_DEFAULT}`

    if (!fs.existsSync(configFilePath)) {
      return {}
    }
  }

  try {
    const config = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'))

    // prettier-ignore
    return {
      projectId: config.project,
      accessKey: config.key,
      silent: config.silent,
      service: config.service,
      retries: config.number,
      labels: config.labels,
      emojis: config.noEmojis === undefined ? undefined : !config.noEmojis,
      spinners: config.noSpinners === undefined ? undefined : !config.noSpinners,
    }
  } catch (err) {
    throw new Error(`Could not parse config file: ${configFilePath}`)
  }
}

const LABEL_NAME_CHAR_LIMIT = 32
const LABEL_VALUE_CHAR_LIMIT = 512

// overall limit is equivalent of 10 completely full labels
const LABELS_TOTAL_CHAR_LIMIT =
  (LABEL_NAME_CHAR_LIMIT + LABEL_VALUE_CHAR_LIMIT) * 10

const configFileLabelsInvalidMessage =
  'labels property in boxci.json must be an array of { name: string, value: string } objects'
const labelKeyTooLongMessage = (label: ProjectBuildLabel) =>
  `Could not add label [ ${label.name} ] - the maximum length of a label name is ${LABEL_NAME_CHAR_LIMIT} characters`
const labelValueTooLongMessage = (label: ProjectBuildLabel) =>
  `Could not add label [ ${label.name} ] with value [ ${label.value} ] - the maximum length of a label value is ${LABEL_VALUE_CHAR_LIMIT} characters`
const overallLabelLengthLimitExceededMessage = (label: ProjectBuildLabel) =>
  `Could not add label [ ${label.name} ] with value [ ${label.value} ] - - the maximum total number of characters allowed across all labels is ${LABELS_TOTAL_CHAR_LIMIT} characters. Either reduce the length of your keys/values or use fewer labels`

const validateLabelLength = (label: ProjectBuildLabel) => {
  if (label.name.length > LABEL_NAME_CHAR_LIMIT) {
    throw new Error(labelKeyTooLongMessage(label))
  }

  if (label.value.length > LABEL_VALUE_CHAR_LIMIT) {
    throw new Error(labelValueTooLongMessage(label))
  }

  return label
}

const buildLabels = (
  configFile: any,
  cli: Command,
): Array<ProjectBuildLabel> => {
  const labels: Array<ProjectBuildLabel> = []

  if (configFile.labels) {
    if (!(configFile.labels instanceof Array)) {
      throw new Error(configFileLabelsInvalidMessage)
    }

    configFile.labels.forEach((label: any) => {
      if (
        label.name === undefined ||
        label.value === undefined ||
        typeof label.name !== 'string' ||
        typeof label.value !== 'string'
      ) {
        throw new Error(
          configFileLabelsInvalidMessage +
            ' - invalid label definition:\n\n' +
            JSON.stringify(label, null, 2) +
            '\n\nShould be a { "name": string, "value": string } object\n\n',
        )
      }

      labels.push(validateLabelLength(label))
    })
  }

  // cli.label holds the array of labels passed to the cli
  cli.label.forEach((cliLabelOptionValue: string) => {
    const parsedCliLabelOptionValue = cliLabelOptionValue.split(',')

    if (parsedCliLabelOptionValue.length !== 2) {
      throw new Error(
        `Could not parse [ --label ${cliLabelOptionValue} ] Syntax is --label key,value`,
      )
    }

    labels.push(
      validateLabelLength({
        name: parsedCliLabelOptionValue[0],
        value: parsedCliLabelOptionValue[1],
      }),
    )
  })

  // validate labels fit within overall label content length limits
  let charTotal = 0
  labels.forEach((label: ProjectBuildLabel) => {
    charTotal += label.name.length + label.value.length

    if (charTotal > LABELS_TOTAL_CHAR_LIMIT) {
      throw new Error(overallLabelLengthLimitExceededMessage(label))
    }
  })

  return labels
}

const get = (cli: Command, cwd: string): Config => {
  const configFile = getConfigFromFileIfExists(cli, cwd)

  const projectId = configFile.projectId || cli.project

  if (!projectId) {
    throw new Error(
      `The --project option must be provided, with the id of your project. For example: --project xg16js87mw`,
    )
  }

  const accessKey = configFile.accessKey || cli.key

  if (!accessKey) {
    throw new Error(
      `The --key option must be provided, with the secret key of your project. You can get this from https://boxci.dev/project/${cli.project} if you have access.`,
    )
  }

  let retriesCandidate = configFile.retries || cli.retries

  let retries

  try {
    retries = parseInt(cli.retries)
  } catch (err) {
    // swallow
  }

  if (!retries || retries < 0 || retries > 100) {
    throw new Error(
      `The --retries option must be in the range 0-100. You passed ${retriesCandidate}`,
    )
  }

  const emojis = configFile.emojis || cli.emojis
  const service = configFile.service || cli.service
  const silent = configFile.silent || cli.silent

  // spinners don't work correctly with extra log statements printed
  // in between being started and stopped, so just turn them off if logging enabled
  const spinners = process.env.BOXCI_LOG_LEVEL
    ? false
    : configFile.spinners || cli.spinners

  const config: Config = {
    projectId,
    accessKey,
    emojis,
    spinners,
    silent,
    service,
    retries,
    labels: buildLabels(configFile, cli),
  }

  // used for tests, might also be useful in some production applications
  if (process.env.BOXCI_PRINT_CONFIG === 'true') {
    console.log(`\nConfig: ${JSON.stringify(config, null, 2)}\n\n`)
  }

  return config
}

export default get
