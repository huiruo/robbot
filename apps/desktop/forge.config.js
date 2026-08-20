const path = require('node:path');
const fsSync = require('node:fs');
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
  const repoRoot = path.resolve(__dirname, '../..');
  const searchPaths = [repoRoot, __dirname];

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

function copyPackageDirectory(sourcePath, targetPath) {
  const realSourcePath = fsSync.realpathSync(sourcePath);

  fsSync.rmSync(targetPath, { force: true, recursive: true });
  fsSync.mkdirSync(path.dirname(targetPath), { recursive: true });
  fsSync.cpSync(realSourcePath, targetPath, {
    recursive: true,
    filter(source) {
      return source === realSourcePath || !path.relative(realSourcePath, source).split(path.sep).includes('node_modules');
    },
  });
}

function ensurePackageCopy(packageName, targetPath) {
  copyPackageDirectory(resolvePackageDir(packageName), targetPath);
}

function ensureWorkspacePackageCopy(packageName, packageDir) {
  copyPackageDirectory(packageDir, path.join(__dirname, 'node_modules', ...packagePathParts(packageName)));
}

module.exports = {
  hooks: {
    async prePackage() {
      ensureWorkspacePackageCopy('@robbot/core', path.resolve(__dirname, '../../packages/core'));
      ensureWorkspacePackageCopy('@robbot/dsh-adapter', path.resolve(__dirname, '../../packages/dsh-adapter'));
      ensurePackageCopy('better-sqlite3', path.join(__dirname, 'node_modules', 'better-sqlite3'));
      ensurePackageCopy('drizzle-orm', path.join(__dirname, 'node_modules', 'drizzle-orm'));
      ensurePackageCopy(
        'electron-squirrel-startup',
        path.join(__dirname, 'node_modules', 'electron-squirrel-startup'),
      );
      ensurePackageCopy('node-addon-api', path.join(__dirname, 'node_modules', 'node-addon-api'));

      const betterSqlite3Dir = resolvePackageDir('better-sqlite3');

      ensurePackageCopy('node-addon-api', path.join(betterSqlite3Dir, 'node_modules', 'node-addon-api'));
    },
  },
  packagerConfig: {
    asar: true,
    electronVersion,
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
