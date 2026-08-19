import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const submoduleName = 'vendor/deepseek-harness';
const dshRoot = path.resolve(submoduleName);
const corepackHome = path.resolve('.cache/corepack');

function exec(command: string, args: string[], options: { cwd?: string; capture?: boolean; allowFailure?: boolean } = {}): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', COREPACK_HOME: corepackHome },
    stdio: options.capture ? 'pipe' : 'inherit',
  });

  if (!options.allowFailure && result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return options.capture ? result.stdout.trim() : '';
}

function readTrackingBranch(): string {
  if (!existsSync('.gitmodules')) {
    return 'master';
  }

  const gitmodules = readFileSync('.gitmodules', 'utf8');
  const match = gitmodules.match(/submodule "vendor\/deepseek-harness"[\s\S]*?branch\s*=\s*(\S+)/);
  return match?.[1] ?? 'master';
}

function prepareSubmoduleWorktreeConfig(): void {
  const worktreeConfigEnabled = exec('git', ['config', '--get', 'extensions.worktreeConfig'], {
    cwd: dshRoot,
    capture: true,
    allowFailure: true,
  });

  if (worktreeConfigEnabled === 'true') {
    return;
  }

  const coreWorktree = exec('git', ['config', '--get', 'core.worktree'], {
    cwd: dshRoot,
    capture: true,
    allowFailure: true,
  });

  if (!coreWorktree) {
    return;
  }

  exec('git', ['config', '--unset', 'core.worktree'], { cwd: dshRoot });
  exec('git', ['config', 'extensions.worktreeConfig', 'true'], { cwd: dshRoot });
  exec('git', ['config', '--worktree', 'core.worktree', coreWorktree], { cwd: dshRoot });
}

if (!existsSync(path.join(dshRoot, '.git'))) {
  console.error('DSH submodule is missing. Run: git submodule update --init --recursive');
  process.exit(1);
}

prepareSubmoduleWorktreeConfig();

const dirty = exec('git', ['status', '--porcelain'], { cwd: dshRoot, capture: true });
if (dirty) {
  console.error('Refusing to update dirty DSH submodule. Commit, stash, or discard changes inside vendor/deepseek-harness first.');
  process.exit(1);
}

const branch = readTrackingBranch();
const oldSha = exec('git', ['rev-parse', 'HEAD'], { cwd: dshRoot, capture: true });

exec('git', ['fetch', 'origin'], { cwd: dshRoot });
exec('git', ['checkout', `origin/${branch}`], { cwd: dshRoot });

const newSha = exec('git', ['rev-parse', 'HEAD'], { cwd: dshRoot, capture: true });

exec('corepack', ['pnpm', 'install', '--frozen-lockfile'], { cwd: dshRoot });
exec('corepack', ['pnpm', 'run', 'build'], { cwd: dshRoot });
exec('pnpm', ['test:dsh']);
exec('pnpm', ['test']);

console.log('');
console.log('DSH upgrade report');
console.log(`${oldSha} -> ${newSha}`);
console.log('Build: PASS');
console.log('Contract tests: PASS');
console.log('Robbot tests: PASS');
console.log('');
console.log('Review with: git diff --submodule=log vendor/deepseek-harness');
console.log('Commit with: git add vendor/deepseek-harness && git commit -m "chore: update deepseek-harness"');
