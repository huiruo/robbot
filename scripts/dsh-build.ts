import { spawnSync } from 'node:child_process';
import path from 'node:path';

const dshRoot = path.resolve('vendor/deepseek-harness');
const corepackHome = path.resolve('.cache/corepack');
// pnpm/action-setup provides pnpm directly on GitHub Actions. Windows needs a
// shell to execute the pnpm.cmd shim; keep direct spawning for macOS/Linux.
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(pnpmCommand, ['run', 'build'], {
  cwd: dshRoot,
  env: { ...process.env, CI: 'true', COREPACK_HOME: corepackHome },
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Failed to start ${pnpmCommand}: ${result.error.message}`);
}
process.exit(result.status ?? 1);
