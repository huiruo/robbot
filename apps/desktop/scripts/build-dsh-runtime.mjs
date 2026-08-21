import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(appDir, '../..');
const dshRoot = path.join(repoRoot, 'vendor', 'deepseek-harness');
const outputDir = path.resolve(process.argv[2] ?? path.join(appDir, '.runtime', 'dsh'));
const runtimeLayoutVersion = 2;

function exists(relativePath) {
  return fs.existsSync(path.join(dshRoot, relativePath));
}

function assertDshBuildReady() {
  const missing = [
    'package.json',
    'apps/cli/lib/bin.js',
    'apps/web/dist',
  ].filter(relativePath => !exists(relativePath));

  if (missing.length > 0) {
    throw new Error(
      `DSH runtime is not built. Missing: ${missing.join(', ')}. Run from repo root: pnpm dsh:build`,
    );
  }
}

function packageParts(packageName) {
  return packageName.split('/');
}

function packageManifest(packageDir) {
  return JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
}

function packageDirectoryExists(packageDir) {
  return fs.existsSync(path.join(packageDir, 'package.json'));
}

function resolvePackageDirectory(packageName) {
  const directPath = path.join(dshRoot, 'node_modules', ...packageParts(packageName));
  if (packageDirectoryExists(directPath)) {
    return fs.realpathSync(directPath);
  }

  const workspacePath = path.join(dshRoot, 'node_modules', '.pnpm', 'node_modules', ...packageParts(packageName));
  if (packageDirectoryExists(workspacePath)) {
    return fs.realpathSync(workspacePath);
  }

  const virtualStore = path.join(dshRoot, 'node_modules', '.pnpm');
  const suffix = path.join('node_modules', ...packageParts(packageName));
  for (const entry of fs.readdirSync(virtualStore)) {
    const candidate = path.join(virtualStore, entry, suffix);
    if (packageDirectoryExists(candidate)) {
      return fs.realpathSync(candidate);
    }
  }

  throw new Error(`Unable to resolve DSH runtime dependency: ${packageName}`);
}

function copyPackageDirectory(sourcePath, targetPath) {
  const sourceRealPath = fs.realpathSync(sourcePath);
  fs.rmSync(targetPath, { force: true, recursive: true });
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourceRealPath, targetPath, {
    dereference: true,
    recursive: true,
    filter(source) {
      if (source === sourceRealPath) {
        return true;
      }

      const parts = path.relative(sourceRealPath, source).split(path.sep);
      return !parts.some(part => [
        '.git',
        '.github',
        '.cache',
        '.turbo',
        'coverage',
        'node_modules',
        'test',
        'tests',
        '__tests__',
      ].includes(part))
        && !source.endsWith('.map')
        && !source.endsWith('.tsbuildinfo');
    },
  });
}

function materializePackage(packageName, seen = new Set()) {
  if (seen.has(packageName)) {
    return;
  }
  seen.add(packageName);

  const sourcePath = resolvePackageDirectory(packageName);
  const targetPath = path.join(outputDir, 'node_modules', ...packageParts(packageName));
  const manifest = packageManifest(sourcePath);
  copyPackageDirectory(sourcePath, targetPath);

  const dependencies = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  };
  for (const childPackageName of Object.keys(dependencies)) {
    try {
      materializePackage(childPackageName, seen);
    } catch (error) {
      if (!manifest.optionalDependencies?.[childPackageName] && !manifest.peerDependencies?.[childPackageName]) {
        throw error;
      }
    }
  }
}

function buildFlatRuntime() {
  fs.rmSync(outputDir, { force: true, recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const cliPath = path.join(dshRoot, 'apps', 'cli');
  const cliManifest = packageManifest(cliPath);
  fs.writeFileSync(path.join(outputDir, 'package.json'), `${JSON.stringify(cliManifest, null, 2)}\n`);
  copyPackageDirectory(cliPath, outputDir);

  const seen = new Set();
  for (const packageName of Object.keys({
    ...cliManifest.dependencies,
    ...cliManifest.optionalDependencies,
    ...cliManifest.peerDependencies,
  })) {
    try {
      materializePackage(packageName, seen);
    } catch (error) {
      if (!cliManifest.optionalDependencies?.[packageName] && !cliManifest.peerDependencies?.[packageName]) {
        throw error;
      }
    }
  }
  console.log(`[robbot:dsh-runtime] materialized ${seen.size} packages into a flat runtime node_modules`);
}

function removeGeneratedNoise(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === '.github' || entry.name === '.cache') {
        fs.rmSync(absolutePath, { force: true, recursive: true });
        continue;
      }
      removeGeneratedNoise(absolutePath);
      continue;
    }

    if (
      entry.name.endsWith('.map')
      || entry.name.endsWith('.tsbuildinfo')
      || entry.name === 'README.i18n.yaml'
    ) {
      fs.rmSync(absolutePath, { force: true });
    }
  }
}

function writeRuntimeMarker() {
  fs.writeFileSync(
    path.join(outputDir, 'robbot-runtime.json'),
    `${JSON.stringify({
      kind: 'robbot-dsh-runtime',
      package: '@deepseek-ai/dsh',
      layoutVersion: runtimeLayoutVersion,
      generatedAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );
}

assertDshBuildReady();
buildFlatRuntime();
removeGeneratedNoise(outputDir);
writeRuntimeMarker();
