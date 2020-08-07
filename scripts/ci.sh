#!/usr/bin/env sh

set -e

timer_start=$SECONDS

# build dependencies image (using cache)
printf "\n\n📦  Getting dependencies\n\n\n"
docker build \
  -f ./dependencies.Dockerfile \
  -t boxci-build-dependencies:$BOXCI_COMMIT_SHORT \
  . &&

# build shared build image
printf "\n\n📦  Running build\n\n\n"
docker build \
  --no-cache \
  -f ./build.Dockerfile \
  -t boxci-build:$BOXCI_COMMIT_SHORT \
  --build-arg BOXCI_COMMIT_SHORT=$BOXCI_COMMIT_SHORT \
  . &&

printf "\n\n🚀 Build succeeded in $(( $SECONDS - timer_start )) seconds\n\n" || exit 1