#!/usr/bin/env sh

echo "test ui script started - $1 lines of stdout output, $1 lines of stderr output"
echo "test ui script started - $1 lines of stderr output, $1 lines of stdout output" >&2

for ((i=0; i<=$1; i++)); do
  echo "test ui - stdout line $i"
  sleep 0.1s
  echo "test ui - stderr line $i" >&2
  sleep 0.1s
done

echo "test ui - stdout FINISHED"
echo "test ui - stderr FINISHED" >&2