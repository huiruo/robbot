import { spawnSync } from 'node:child_process';
import path from 'node:path';

const dshRoot = path.resolve('vendor/deepseek-harness');
const corepackHome = path.resolve('.cache/corepack');
// Windows exposes Corepack as a .cmd shim when spawning without a shell.
const corepackCommand = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
const result = spawnSync(corepackCommand, ['pnpm', 'run', 'build'], {
  cwd: dshRoot,
  env: { ...process.env, CI: 'true', COREPACK_HOME: corepackHome },
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
