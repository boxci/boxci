#!/usr/bin/env sh
# use this script to test real service implementations, passing projectId, key and serviceUrl as args

set -e

project_id=$1
if [ -z $project_id ]; then
  printf "\nError: Pass Project ID as the first arg\n\n"
  exit 0
fi

access_key=$2
if [ -z $access_key ]; then
  printf "\nError: Pass Access Key as the second arg\n\n"
  exit 0
fi

service_url=$3
if [ -z $service_url ]; then
  printf "\nError: Pass Service Url as the third arg\n\n"
  exit 0
fi

printf "\n\nARGS PASSED:\n  project_id: $project_id\n  access_key: $access_key\n  service_url: $service_url\n\n"

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

printf "\n\n--- built test cli from source at ./cli, test service, and verify script ---\n\n"

# TEST CASES

# set the amount of lines to print here
lines_both=200
lines_single=300

# stdout and stderr
node $SCRIPT_DIR/compiled/cli/index.js "sh $SCRIPT_DIR/test-integration-both.sh $lines_both" \
  --project $project_id \
  --key $access_key \
  --service $service_url \
  --retries 10 \
  --label 'test-label,test-value' \
  --label 'another-test-label,another-test-value'


# only stdout
node $SCRIPT_DIR/compiled/cli/index.js "sh $SCRIPT_DIR/test-integration-stdout.sh $lines_single" \
  --project $project_id \
  --key $access_key \
  --service $service_url \
  --retries 10


# only stderr
node $SCRIPT_DIR/compiled/cli/index.js "sh $SCRIPT_DIR/test-integration-stderr.sh $lines_single" \
  --project $project_id \
  --key $access_key \
  --service $service_url \
  --retries 10
