ARG BOXCI_COMMIT_SHORT
FROM boxci-app-build-dependencies:${BOXCI_COMMIT_SHORT} as dependencies-stage

FROM dependencies-stage as build-stage

# setup
ENV NODE_ENV production
WORKDIR /usr/src/app

# copy files needed for build
COPY tsconfig.json .
COPY webpack.config.js .
COPY src ./src
COPY scripts ./scripts

# run CI build
RUN sh ./scripts/ci-build.sh
