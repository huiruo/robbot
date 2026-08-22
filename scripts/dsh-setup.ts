import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const dshRoot = path.resolve('vendor/deepseek-harness');
const corepackHome = path.resolve('.cache/corepack');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function exec(command: string, args: string[], options: { cwd?: string; capture?: boolean; allowFailure?: boolean } = {}): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', COREPACK_HOME: corepackHome },
    shell: process.platform === 'win32',
    stdio: options.capture ? 'pipe' : 'inherit',
  });

  if (result.error) {
    console.error(`Failed to start ${command}: ${result.error.message}`);
  }

  if (!options.allowFailure && result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return options.capture ? result.stdout.trim() : '';
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

if (!existsSync(path.join(dshRoot, 'package.json'))) {
  console.error('DSH submodule is missing. Run: git submodule update --init --recursive');
  process.exit(1);
}

prepareSubmoduleWorktreeConfig();
exec(pnpmCommand, ['install'], { cwd: dshRoot });
exec(pnpmCommand, ['run', 'build'], { cwd: dshRoot });
