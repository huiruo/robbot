import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const outDir = path.join(appDir, 'out');
const appPath = path.join(outDir, 'Robbot-darwin-arm64', 'Robbot.app');
const dmgDir = path.join(outDir, 'make');
const dmgPath = path.join(dmgDir, 'Robbot-darwin-arm64.dmg');

function sizeBytes(targetPath) {
  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    return stat.size;
  }

  return fs.readdirSync(targetPath).reduce((total, entry) => total + sizeBytes(path.join(targetPath, entry)), 0);
}

function formatBytes(bytes) {
  const units = ['B', 'K', 'M', 'G'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)}${units[unitIndex]}`;
}

if (process.platform !== 'darwin') {
  console.error('create-mac-dmg.mjs must run on macOS because it uses hdiutil.');
  process.exit(1);
}

if (!fs.existsSync(appPath)) {
  console.error(`Robbot.app was not found: ${appPath}`);
  console.error('Run npm run package first.');
  process.exit(1);
}

fs.mkdirSync(dmgDir, { recursive: true });

const result = spawnSync('hdiutil', [
  'create',
  '-volname',
  'Robbot',
  '-srcfolder',
  appPath,
  '-ov',
  '-format',
  'UDBZ',
  dmgPath,
], {
  cwd: appDir,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  throw new Error(`hdiutil exited with ${String(result.status)}`);
}

console.log(`[robbot:dmg] app: ${formatBytes(sizeBytes(appPath))}`);
console.log(`[robbot:dmg] dmg: ${formatBytes(sizeBytes(dmgPath))}`);
console.log(`[robbot:dmg] output: ${dmgPath}`);
