const webpack = require('webpack')
const package = require('./package.json')
const WebPackBundleAnalyzer = require('webpack-bundle-analyzer')

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
    // adds the shebang needed to run boxci as a bin to the top of the bundle
    new webpack.BannerPlugin({
      banner: '#!/usr/bin/env node',
      raw: true,
    }),
    new webpack.DefinePlugin({
      ['process.env.NPM_VERSION']: JSON.stringify(package.version),
    }),

    // analyse the bundle when ANALYSE env var set to true
    ...(process.env.ANALYSE === 'true'
      ? [new WebPackBundleAnalyzer.BundleAnalyzerPlugin()]
      : []),
  ],
  optimization: {
    sideEffects: true,
  },
}
