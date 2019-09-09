import 'isomorphic-fetch'
import { ProjectBuild } from './TestService'
import { LogsChunk } from '../../src/api'

const getProjectBuilds = async (
  port: string,
): Promise<{ [runId: string]: ProjectBuild }> =>
  (await (await fetch(`http://localhost:${port}/project-builds`, {
    method: 'GET',
  })).json()) as { [runId: string]: ProjectBuild }

const EXPECTED = {
  test1: {
    stdout: `test 1 - line 1
test 1 - line 2
test 1 - line 3
test 1 - line 4
test 1 - line 5
test 1 - line 6
test 1 - line 7
test 1 - line 8
test 1 - line 9
test 1 - line 10
test 1 - line 11
test 1 - line 12
`,
    stderr: ``,
  },
  test2: {
    stdout: `test 2 - line 1
test 2 - line 3
test 2 - line 4
test 2 - line 5
test 2 - line 8
test 2 - line 9
test 2 - line 10
`,
    stderr: `test 2 - line 2 ERROR
test 2 - line 6 ERROR
test 2 - line 7 ERROR
test 2 - line 11 ERROR
test 2 - line 12 ERROR
`,
  },
}

const printCommands = (runs: { [runId: string]: ProjectBuild }): string => {
  const commands = []

  for (let runId in runs) {
    commands.push(runs[runId].command)
  }

  return JSON.stringify(commands, null, 2)
}

const getTestRun = (
  runs: { [runId: string]: ProjectBuild },
  scriptFileName: string,
): ProjectBuild => {
  for (let runId in runs) {
    const candidate = runs[runId]

    if (candidate.command.indexOf(scriptFileName) > -1) {
      return candidate
    }
  }

  throw new Error(
    `Test run with script filename ${scriptFileName} not found.\n\nCommands run:\n\n${printCommands(
      runs,
    )}\n\n`,
  )
}

const EMPTY_STRING = '<empty string>'

const verify = async () => {
  const port = process.argv[2] as string // passed as an arg to the verify command by run-tests.sh
  const runs = await getProjectBuilds(port)

  const test1 = getTestRun(runs, 'test-1.sh')

  const test1Stdout: string = test1.stdout.chunks.reduce(
    (output: string, { c: chunkContent }: LogsChunk) => output + chunkContent,
    '',
  )
  const test1Stderr: string = test1.stderr.chunks.reduce(
    (output: string, { c: chunkContent }: LogsChunk) => output + chunkContent,
    '',
  )

  console.log(`Verifying runs from Test Service running on port ${port}`)
  console.log(`  - test-1.sh`)

  if (test1Stdout === EXPECTED.test1.stdout) {
    console.log(`    ✔ stdout matches expected`)
  } else {
    console.log(`    ✗ stdout does not match expected`)
    console.log(
      `EXPECTED:\n--- start ---\n${EXPECTED.test1.stdout ||
        EMPTY_STRING}\n--- end ---\n\nACTUAL:\n--- start ---\n${test1Stdout ||
        EMPTY_STRING}\n--- end ---\n\n`,
    )
  }

  if (test1Stderr === EXPECTED.test1.stderr) {
    console.log(`    ✔ stderr matches expected`)
  } else {
    console.log(`    ✗ stderr does not match expected`)
    console.log(
      `EXPECTED:\n--- start ---\n${EXPECTED.test1.stderr ||
        EMPTY_STRING}\n--- end ---\n\nACTUAL:\n--- start ---\n${test1Stderr ||
        EMPTY_STRING}\n--- end ---\n\n`,
    )
  }

  console.log(`\n  - test-2.sh`)

  const test2 = getTestRun(runs, 'test-2.sh')
  const test2Stdout: string = test2.stdout.chunks.reduce(
    (output: string, { c: chunkContent }: LogsChunk) => output + chunkContent,
    '',
  )
  const test2Stderr: string = test2.stderr.chunks.reduce(
    (output: string, { c: chunkContent }: LogsChunk) => output + chunkContent,
    '',
  )

  if (test2Stdout === EXPECTED.test2.stdout) {
    console.log(`    ✔ stdout matches expected`)
  } else {
    console.log(`    ✗ stdout does not match expected`)
    console.log(
      `EXPECTED:\n--- start ---\n${EXPECTED.test2.stdout ||
        EMPTY_STRING}\n--- end ---\n\nACTUAL:\n--- start ---\n${test2Stdout ||
        EMPTY_STRING}\n--- end ---\n\n`,
    )
  }

  if (test2Stderr === EXPECTED.test2.stderr) {
    console.log(`    ✔ stderr matches expected`)
  } else {
    console.log(`    ✗ stderr does not match expected`)
    console.log(
      `EXPECTED:\n--- start ---\n${EXPECTED.test2.stderr ||
        EMPTY_STRING}\n--- end ---\n\nACTUAL:\n--- start ---\n${test2Stderr ||
        EMPTY_STRING}\n--- end ---\n\n`,
    )
  }

  console.log('')
}

// run tests
verify()
