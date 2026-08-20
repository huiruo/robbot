const path = require('node:path');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const electronVersion = require('./package.json').devDependencies.electron.replace(/^[^\d]*/, '');

function packagePathParts(packageName) {
  return packageName.split('/');
}

function packageDirExists(packageDir) {
  return fsSync.existsSync(path.join(packageDir, 'package.json'));
}

function findPnpmPackageDir(packageName, rootDir) {
  const virtualStore = path.join(rootDir, 'node_modules', '.pnpm');

  if (!fsSync.existsSync(virtualStore)) {
    return undefined;
  }

  const packageSuffix = path.join('node_modules', ...packagePathParts(packageName));

  for (const entry of fsSync.readdirSync(virtualStore)) {
    const packageDir = path.join(virtualStore, entry, packageSuffix);

    if (packageDirExists(packageDir)) {
      return packageDir;
    }
  }

  return undefined;
}

function resolvePackageDir(packageName) {
  const searchPaths = [__dirname, path.resolve(__dirname, '../..')];

  for (const searchPath of searchPaths) {
    const directPackageDir = path.join(searchPath, 'node_modules', ...packagePathParts(packageName));

    if (packageDirExists(directPackageDir)) {
      return directPackageDir;
    }

    const pnpmPackageDir = findPnpmPackageDir(packageName, searchPath);

    if (pnpmPackageDir) {
      return pnpmPackageDir;
    }
  }

  throw new Error(`Could not locate package root for ${packageName}`);
}

function ensurePackageLink(packageName, linkPath) {
  const target = resolvePackageDir(packageName);

  fsSync.mkdirSync(path.dirname(linkPath), { recursive: true });
  fsSync.rmSync(linkPath, { force: true, recursive: true });
  fsSync.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

async function removeDevelopmentMetadata(buildPath) {
  const packageJsonPath = path.join(buildPath, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));

  delete packageJson.devDependencies;
  delete packageJson.scripts;

  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

module.exports = {
  hooks: {
    async prePackage() {
      const betterSqlite3Dir = resolvePackageDir('better-sqlite3');

      ensurePackageLink('node-addon-api', path.join(betterSqlite3Dir, 'node_modules', 'node-addon-api'));
    },
  },
  packagerConfig: {
    asar: true,
    electronVersion,
    icon: path.resolve(__dirname, 'assets/icon'),
    afterCopy: [removeDevelopmentMetadata],
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
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'huiruo',
          name: 'robbot',
        },
        // Keep releases as drafts until the artifacts have been reviewed.
        draft: true,
        prerelease: false,
        generateReleaseNotes: true,
      },
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
