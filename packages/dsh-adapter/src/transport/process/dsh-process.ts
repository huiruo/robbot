import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import path from 'node:path';

import { HarnessError } from '@robbot/core';

import { StdioChannel } from './stdio-channel.js';

export class DshProcess {
  private child?: ChildProcessWithoutNullStreams;
  private channel?: StdioChannel;
  constructor(
    private readonly cwd: string,
    private readonly configPath = 'examples/acp-agent/cordis.yml',
  ) {}

  async start(): Promise<StdioChannel> {
    if (this.channel) {
      return this.channel;
    }

    const nodeExecutable = resolveNodeExecutable();
    const args = [
      '--import',
      'tsx',
      'packages/examples/acp-demo/src/bin.ts',
      '--config',
      this.configPath,
    ];

    console.info('[robbot:dsh-process] starting DSH ACP process', {
      cwd: this.cwd,
      nodeExecutable,
      args,
    });

    this.child = spawn(nodeExecutable, args, {
      cwd: this.cwd,
      stdio: 'pipe',
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? readDeepSeekApiKeyFromRobbotEnv(this.cwd) ?? 'sk-dummy-for-boot',
        DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE ?? 'danger-full-access',
        TSX_TSCONFIG_PATH: path.join(this.cwd, 'tsconfig.json'),
      },
    });

    this.child.once('error', (error: Error) => {
      console.error('[robbot:dsh-process] failed to start DSH ACP process', error);
      throw new HarnessError('Failed to start DSH ACP process.', 'transport_error', error);
    });

    this.child.once('exit', (code, signal) => {
      console.info('[robbot:dsh-process] DSH ACP process exited', { code, signal });
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

    console.info('[robbot:dsh-process] stopping DSH ACP process');
    this.child.kill('SIGTERM');
    this.child = undefined;
    this.channel = undefined;
  }
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

function readDeepSeekApiKeyFromRobbotEnv(dshRoot: string): string | undefined {
  const envPath = path.resolve(dshRoot, '../..', '.env');
  let contents: string;
  try {
    contents = readFileSync(envPath, 'utf8');
  } catch {
    return undefined;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separator = line.indexOf('=');
    if (separator < 0 || line.slice(0, separator).trim() !== 'DEEPSEEK_API_KEY') {
      continue;
    }

    const value = unquoteEnvValue(line.slice(separator + 1).trim());
    return value.length > 0 ? value : undefined;
  }

  return undefined;
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
