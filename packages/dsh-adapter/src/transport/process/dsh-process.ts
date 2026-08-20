import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import path from 'node:path';

import { HarnessError } from '@robbot/core';

import { StdioChannel } from './stdio-channel.js';

export type DshProcessProtocol = 'sdk' | 'acp';

export class DshProcess {
  private child?: ChildProcessWithoutNullStreams;
  private channel?: StdioChannel;
  constructor(
    private readonly cwd: string,
    private readonly protocol: DshProcessProtocol,
    private readonly configPath = 'examples/acp-agent/cordis.yml',
    private readonly envOverrides: Record<string, string | undefined> = {},
  ) {}

  async start(): Promise<StdioChannel> {
    if (this.channel) {
      return this.channel;
    }

    const nodeExecutable = resolveNodeExecutable();
    const bin = this.protocol === 'sdk'
      ? 'packages/examples/jsonrpc-demo/src/bin.ts'
      : 'packages/examples/acp-demo/src/bin.ts';
    const args = this.protocol === 'sdk'
      ? ['--import', 'tsx', bin, this.configPath]
      : ['--import', 'tsx', bin, '--config', this.configPath];

    console.info('[robbot:dsh-process] starting DSH process', {
      cwd: this.cwd,
      protocol: this.protocol,
      nodeExecutable,
      args,
    });

    const robbotEnv = readRobbotEnvFromDshRoot(this.cwd);
    this.child = spawn(nodeExecutable, args, {
      cwd: this.cwd,
      stdio: 'pipe',
      env: {
        ...process.env,
        ROBBOT_OPENAI_PROVIDER: process.env.ROBBOT_OPENAI_PROVIDER ?? robbotEnv.ROBBOT_OPENAI_PROVIDER,
        ROBBOT_OPENAI_MODEL: process.env.ROBBOT_OPENAI_MODEL ?? robbotEnv.ROBBOT_OPENAI_MODEL,
        ROBBOT_DEEPSEEK_MODEL: process.env.ROBBOT_DEEPSEEK_MODEL ?? robbotEnv.ROBBOT_DEEPSEEK_MODEL,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? robbotEnv.OPENAI_API_KEY,
        OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? robbotEnv.OPENAI_BASE_URL,
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? robbotEnv.DEEPSEEK_API_KEY ?? 'sk-dummy-for-boot',
        DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? robbotEnv.DEEPSEEK_BASE_URL,
        DSH_MODEL: process.env.DSH_MODEL ?? robbotEnv.DSH_MODEL,
        DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE ?? 'workspace-write',
        DSH_CORDIS_CONFIG: this.configPath,
        TSX_TSCONFIG_PATH: path.join(this.cwd, 'tsconfig.json'),
        ...this.envOverrides,
      },
    });

    this.child.once('error', (error: Error) => {
      console.error('[robbot:dsh-process] failed to start DSH process', error);
      throw new HarnessError('Failed to start DSH process.', 'transport_error', error);
    });

    this.child.once('exit', (code, signal) => {
      console.info('[robbot:dsh-process] DSH process exited', { protocol: this.protocol, code, signal });
    });

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      console.warn('[robbot:dsh-process:stderr]', chunk.trim());
    });

    this.channel = new StdioChannel(this.child.stdin, this.child.stdout, this.child.stderr);
    return this.channel;
  }

  getChannel(): StdioChannel {
    if (!this.channel) {
      throw new HarnessError('DSH process has not been started.', 'transport_error');
    }

    return this.channel;
  }

  async stop(): Promise<void> {
    if (!this.child || this.child.killed) {
      return;
    }

    console.info('[robbot:dsh-process] stopping DSH process', { protocol: this.protocol });
    this.child.kill('SIGTERM');
    this.child = undefined;
    this.channel = undefined;
  }
}

export function readRobbotEnvValueFromDshRoot(dshRoot: string, name: string): string | undefined {
  return readRobbotEnvFromDshRoot(dshRoot)[name];
}

function resolveNodeExecutable(): string {
  if (!isElectronRuntime()) {
    return process.execPath;
  }

  for (const candidate of [
    process.env.ROBBOT_NODE_EXECUTABLE,
    process.env.NODE_BINARY,
    resolveNodeFromPath(),
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ]) {
    if (candidate && isExecutableFile(candidate)) {
      return candidate;
    }
  }

  throw new HarnessError(
    'Unable to find a Node.js executable for starting DSH from Electron. Set ROBBOT_NODE_EXECUTABLE=/absolute/path/to/node.',
    'transport_error',
  );
}

function resolveNodeFromPath(): string | undefined {
  const resolved = spawnSync('/usr/bin/env', ['node', '-p', 'process.execPath'], {
    encoding: 'utf8',
  });
  if (resolved.status !== 0) {
    return undefined;
  }

  return resolved.stdout.trim() || undefined;
}

function isExecutableFile(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isElectronRuntime(): boolean {
  return Boolean(process.versions.electron);
}

function readRobbotEnvFromDshRoot(dshRoot: string): Record<string, string> {
  const envPath = path.resolve(dshRoot, '../..', '.env');
  let contents: string;
  try {
    contents = readFileSync(envPath, 'utf8');
  } catch {
    return {};
  }

  const env: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separator = line.indexOf('=');
    if (separator < 0) {
      continue;
    }

    const name = line.slice(0, separator).trim();
    const value = unquoteEnvValue(line.slice(separator + 1).trim());
    if (name && value.length > 0) {
      env[name] = value;
    }
  }

  return env;
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
