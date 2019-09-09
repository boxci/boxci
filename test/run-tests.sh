#!/usr/bin/env sh

# shut down test service in case it is running from a previous test run where the script threw before finishing
curl -s http://localhost:3050/shutdown &> /dev/null

set -e

# logs the config before each test run
export BOXCI_PRINT_CONFIG="true"

SCRIPT_DIR="$( cd "$(dirname "$0")" ; pwd -P )"

# clean compiled dir
rm -rf $SCRIPT_DIR/compiled

# build the test candidate cli
npx --no-install tsc \
  --outDir $SCRIPT_DIR/compiled/cli \
  --esModuleInterop \
  --module commonjs \
  --allowSyntheticDefaultImports \
  --moduleResolution node \
  $SCRIPT_DIR/../src/index.ts

# build the test service in background
npx --no-install tsc \
  --outDir $SCRIPT_DIR/compiled/test-service \
  --esModuleInterop \
  --module commonjs \
  --allowSyntheticDefaultImports \
  --moduleResolution node \
  $SCRIPT_DIR/src/index.ts

npx --no-install tsc \
  --outDir $SCRIPT_DIR/compiled \
  --esModuleInterop \
  --module commonjs \
  --allowSyntheticDefaultImports \
  --moduleResolution node \
  $SCRIPT_DIR/src/verify.ts

printf "\n\n--- built test cli from source at ./cli, test service, and verify script ---\n\n"

node $SCRIPT_DIR/compiled/test-service/test/src/index.js &
printf "\n\n$SCRIPT_DIR/compiled/test-service/test/src/index.js running in background on port 3050\n\n"

run_test() {
  port=$1

  # 10 is the default anyway, easier just to pass it
  # than have two version of command if no second argument is passed
  retries=${2:-10}

  # prints the test description in the output
  curl -s "http://localhost:$port/description" &> /dev/null

  test1_command="sh $SCRIPT_DIR/test-1.sh"
  test2_command="sh $SCRIPT_DIR/test-2.sh"

  node $SCRIPT_DIR/compiled/cli/index.js "$test1_command" \
    --project TESTID \
    --key TESTKEY \
    --service "http://localhost:$port" \
    --retries $retries \
    --silent

  node $SCRIPT_DIR/compiled/cli/index.js "$test2_command" \
    --project TESTID \
    --key TESTKEY \
    --service "http://localhost:$port" \
    --retries $retries \
    --silent

  node $SCRIPT_DIR/compiled/test/src/verify.js $port
}

# -----------------------------------
# TEST CASES

# allow service to start before running test cases
sleep 2s

# good network conditions
run_test 3051

# random latency from 0-5s
run_test 3052

# random latency from 5-10s
run_test 3053

# random latency from 0-10s
run_test 3054

# requests fail randomly 10% of the time
run_test 3055 100

# requests fail randomly 20% of the time
run_test 3056 100

# requests fail randomly 30% of the time
run_test 3057 100

# requests fail randomly 40% of the time
run_test 3058 100

# requests fail randomly 50% of the time
run_test 3059 100

# requests fail randomly 60% of the time
run_test 3060 100

# requests fail randomly 70% of the time
run_test 3061 100

# requests fail randomly 80% of the time
run_test 3062 100

# requests fail randomly 90% of the time
run_test 3063 100

# requests fail randomly 25% of the time, random latency from 0-5s
run_test 3064 100

# requests fail randomly 50% of the time, random latency from 0-5s
run_test 3065 100

# requests fail randomly 75% of the time, random latency from 0-5s
run_test 3066 100

# requests fail randomly 25% of the time, random latency from 5-10s
run_test 3067 100

# requests fail randomly 50% of the time, random latency from 5-10s
run_test 3068 100

# requests fail randomly 75% of the time, random latency from 5-10s
run_test 3069 100

# END OF TEST CASES
# -----------------------------------

# shut down test service
curl -s http://localhost:3050/shutdown &> /dev/null
printf "\n\nTEST SERVICE SHUT DOWN\n\n"


