import { spawnSync } from 'node:child_process';
import path from 'node:path';

const dshRoot = path.resolve('vendor/deepseek-harness');
const corepackHome = path.resolve('.cache/corepack');
const result = spawnSync('corepack', ['pnpm', 'run', 'build'], {
  cwd: dshRoot,
  env: { ...process.env, CI: 'true', COREPACK_HOME: corepackHome },
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
