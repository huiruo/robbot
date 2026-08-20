const path = require('node:path');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    icon: path.resolve(__dirname, 'assets/icon'),
    ignore: [
      /^\/renderer\/node_modules(\/|$)/,
      /^\/renderer\/src(\/|$)/,
      /^\/renderer\/public(\/|$)/,
      /^\/renderer\/\.gitignore$/,
      /^\/renderer\/README\.md$/,
      /^\/renderer\/eslint\.config\.js$/,
      /^\/renderer\/index\.html$/,
      /^\/renderer\/package-lock\.json$/,
      /^\/renderer\/package\.json$/,
      /^\/renderer\/tsconfig.*\.json$/,
      /^\/renderer\/vite\.config\.ts$/,
      /^\/electron\/.*\.ts$/,
      /^\/tsconfig\.electron\.json$/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
