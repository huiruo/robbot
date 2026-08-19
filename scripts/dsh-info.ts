import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

interface RuntimeConfig {
  submodule: string;
  protocol: string;
  profile: string;
  buildRequired: boolean;
}

const corepackHome = path.resolve('.cache/corepack');

function exec(command: string, args: string[], cwd?: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, COREPACK_HOME: corepackHome },
  });
  if (result.status !== 0) {
    return '';
  }
  return result.stdout.trim();
}

const config = JSON.parse(readFileSync('config/dsh-runtime.json', 'utf8')) as RuntimeConfig;
const dshRoot = path.resolve(config.submodule);

const info = {
  commit: exec('git', ['rev-parse', 'HEAD'], dshRoot),
  branch: exec('git', ['branch', '--show-current'], dshRoot) || exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dshRoot),
  protocol: config.protocol,
  profile: config.profile,
  node: exec('node', ['--version']),
  pnpm: exec('corepack', ['pnpm', '--version'], dshRoot),
};

console.log(JSON.stringify(info, null, 2));
