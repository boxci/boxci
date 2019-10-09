#!/usr/bin/env sh
# use this script to test real service implementations, passing projectId, key and serviceUrl as args

set -e

access_key=$1
if [ -z $access_key ]; then
  printf "\nError: Pass Access Key as the first arg\n\n"
  exit 0
fi

SCRIPT_DIR="$( cd "$(dirname "$0")" ; pwd -P )"

# clean compiled dir
rm -rf $SCRIPT_DIR/../test/compiled

# build the cli in  the test dir
npx --no-install tsc \
  --outDir $SCRIPT_DIR/../test/compiled/cli \
  --esModuleInterop \
  --module commonjs \
  --allowSyntheticDefaultImports \
  --moduleResolution node \
  $SCRIPT_DIR/../src/index.ts

printf "\n\n--- built test cli from source at ./cli\n\n"

# now use the built cli to rerun its own build on Box CI
#
# note for now this will only work if the cli built at all
# later could add a fallback to using the latest working
# boxci version if this happens, to show the failed build in Box CI
node $SCRIPT_DIR/../test/compiled/cli/index.js "npm run build" \
  --key $access_key \
  --label commit,$(git rev-parse --short HEAD) \
  --label branch,$(git rev-parse --abbrev-ref HEAD)