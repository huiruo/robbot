import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { HarnessError } from '@robbot/core';

import { StdioChannel } from './stdio-channel.js';

export class DshProcess {
  private child?: ChildProcessWithoutNullStreams;
  private channel?: StdioChannel;
  constructor(private readonly cwd: string) {}

  async start(): Promise<StdioChannel> {
    if (this.channel) {
      return this.channel;
    }

    this.child = spawn(process.execPath, [
      '--import',
      'tsx',
      'packages/examples/acp-demo/src/bin.ts',
      '--config',
      'examples/acp-agent/cordis.yml',
    ], {
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
      throw new HarnessError('Failed to start DSH ACP process.', 'transport_error', error);
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

    this.child.kill('SIGTERM');
    this.child = undefined;
    this.channel = undefined;
  }
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
