import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const packageJsonPath = path.join(appDir, 'package.json');
const forgeCliPath = path.join(appDir, 'node_modules', '@electron-forge', 'cli', 'dist', 'electron-forge.js');
const forgeArgs = process.argv.slice(2);
const resolvedForgeArgs = [forgeArgs[0], appDir, ...forgeArgs.slice(1)];

if (forgeArgs.length === 0) {
  console.error('Usage: node scripts/forge-runtime-package.mjs <package|make|publish> [...args]');
  process.exit(1);
}

const originalPackageJsonText = await fs.readFile(packageJsonPath, 'utf8');
const originalPackageJson = JSON.parse(originalPackageJsonText);
let restored = false;

async function restorePackageJson() {
  if (restored) {
    return;
  }

  restored = true;
  await fs.writeFile(packageJsonPath, originalPackageJsonText);
}

function createRuntimePackageJson() {
  return {
    ...originalPackageJson,
    config: {
      ...originalPackageJson.config,
      forge: './forge.config.js',
    },
    scripts: undefined,
    devDependencies: {
      electron: originalPackageJson.devDependencies.electron,
    },
  };
}

async function runForge() {
  const runtimePackageJson = createRuntimePackageJson();

  await fs.writeFile(packageJsonPath, `${JSON.stringify(runtimePackageJson, null, 2)}\n`);

  const child = spawn(process.execPath, [forgeCliPath, ...resolvedForgeArgs], {
    cwd: appDir,
    env: process.env,
    shell: false,
    stdio: 'inherit',
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      child.kill(signal);
      await restorePackageJson();
      process.kill(process.pid, signal);
    });
  }

  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }

      resolve(code ?? 1);
    });
  });

  await restorePackageJson();
  process.exit(exitCode);
}

try {
  await runForge();
} catch (error) {
  await restorePackageJson();
  throw error;
}
