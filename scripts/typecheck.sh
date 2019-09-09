printf "\nRunning TypeScript type check\n\n" &&
./node_modules/typescript/bin/tsc -p ./tsconfig.json --noEmit &&
printf "  ✓ No TypeScript errors\n\n" || exit 1