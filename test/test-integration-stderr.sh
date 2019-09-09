#!/usr/bin/env sh

echo "test ui script started - $1 lines of stderr output, 0 lines of stdout output" >&2

for ((i=0; i<=$1; i++)); do
  echo "test ui - stderr line $i" >&2
  sleep 0.2s
done

echo "test ui - stderr FINISHED" >&2
