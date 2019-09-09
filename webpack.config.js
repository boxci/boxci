const webpack = require('webpack')
const package = require('./package.json')

module.exports = {
  target: 'node',
  entry: `${__dirname}/src/index.ts`,
  output: {
    path: `${__dirname}/bin/`,
    filename: 'boxci.js',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    strictExportPresence: false,
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader',
      },
    ],
  },
  plugins: [
    // adds the sheband needed to run boxci as a bin to the top of the bundle
    new webpack.BannerPlugin({
      banner: '#!/usr/bin/env node',
      raw: true,
    }),
    new webpack.DefinePlugin({
      ['process.env.NPM_VERSION']: JSON.stringify(package.version),
    }),
  ],
}
