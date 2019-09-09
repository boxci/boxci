#!/usr/bin/env sh

echo "test 2 - line 1"
echo "test 2 - line 2 ERROR" >&2
echo "test 2 - line 3"

sleep 2s

echo "test 2 - line 4"
echo "test 2 - line 5"
echo "test 2 - line 6 ERROR" >&2

sleep 2s

echo "test 2 - line 7 ERROR" >&2
echo "test 2 - line 8"
echo "test 2 - line 9"

sleep 2s

echo "test 2 - line 10"
echo "test 2 - line 11 ERROR" >&2
echo "test 2 - line 12 ERROR" >&2
