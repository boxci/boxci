#!/usr/bin/env sh

echo "test ui script started - $1 lines of stdout output, 0 lines of stderr output"

for ((i=0; i<=$1; i++)); do
  echo "test ui - stdout line $i"
  sleep 0.2s
done

echo "test ui - stdout FINISHED"