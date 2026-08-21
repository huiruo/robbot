import { spawnSync } from 'node:child_process';
import path from 'node:path';

const dshRoot = path.resolve('vendor/deepseek-harness');
const corepackHome = path.resolve('.cache/corepack');
// pnpm/action-setup provides pnpm directly on GitHub Actions. Use its Windows
// shim explicitly because .cmd files cannot be spawned by Node as plain names.
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(pnpmCommand, ['run', 'build'], {
  cwd: dshRoot,
  env: { ...process.env, CI: 'true', COREPACK_HOME: corepackHome },
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Failed to start ${pnpmCommand}: ${result.error.message}`);
}
process.exit(result.status ?? 1);
