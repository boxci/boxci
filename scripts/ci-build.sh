#!/usr/bin/env sh

set -e

type_check () {
  printf "\n--- running TypeScript type checks\n"
  ts_typecheck_timer_start=$(date +%s)

  ./node_modules/typescript/bin/tsc -p ./tsconfig.json --noEmit &&
  printf "  ✓ no errors (ran in $(( $(date +%s) - ts_typecheck_timer_start )) seconds)\n\n\n\n"
}

type_check || exit 1

npx --no-install webpack --config ./webpack.config.js --mode production
