import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { HarnessError } from '@robbot/core';

import { StdioChannel } from './stdio-channel.js';

export type DshProcessProtocol = 'sdk' | 'acp' | 'web';

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
    const builtCli = isBuiltCliRuntime(this.cwd);
    const bin = builtCli
      ? 'lib/bin.js'
      : this.protocol === 'acp'
        ? 'packages/examples/acp-demo/src/bin.ts'
        : this.protocol === 'sdk'
          ? 'packages/examples/jsonrpc-demo/src/bin.ts'
          : 'apps/cli/src/bin.ts';
    const args = builtCli
      ? builtCliArgs(this.cwd, this.protocol, bin, this.configPath, this.envOverrides)
      : this.protocol === 'sdk'
        ? ['--import', 'tsx', bin, this.configPath]
        : this.protocol === 'acp'
          ? ['--import', 'tsx', bin, '--config', this.configPath]
          : ['--import', 'tsx/esm', bin, 'web', '--host', '127.0.0.1', '--port', envPort(this.envOverrides), '--no-open'];
    console.info('[robbot:dsh-process] starting DSH process', {
      cwd: this.cwd,
      protocol: this.protocol,
      nodeExecutable,
      args,
    });

    // Product runtime config is passed by Electron Main through envOverrides.
    // Reading Robbot's .env here is intentionally retained only as a local-development
    // fallback for adapter-level runs that do not provide metadata.aiRuntime.
    const robbotEnv = readRobbotEnvFromDshRoot(this.cwd);
    const launchEnv: Record<string, string | undefined> = {
      ...process.env,
      ROBBOT_OPENAI_PROVIDER: process.env.ROBBOT_OPENAI_PROVIDER ?? robbotEnv.ROBBOT_OPENAI_PROVIDER,
      ROBBOT_OPENAI_MODEL: process.env.ROBBOT_OPENAI_MODEL ?? robbotEnv.ROBBOT_OPENAI_MODEL,
      ROBBOT_DEEPSEEK_MODEL: process.env.ROBBOT_DEEPSEEK_MODEL ?? robbotEnv.ROBBOT_DEEPSEEK_MODEL,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? robbotEnv.OPENAI_API_KEY,
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? robbotEnv.OPENAI_BASE_URL,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? robbotEnv.DEEPSEEK_API_KEY,
      DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? robbotEnv.DEEPSEEK_BASE_URL,
      DSH_MODEL: process.env.DSH_MODEL ?? robbotEnv.DSH_MODEL,
      DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE ?? 'workspace-write',
      DSH_CORDIS_CONFIG: this.configPath,
      TSX_TSCONFIG_PATH: path.join(this.cwd, 'tsconfig.json'),
      ...this.envOverrides,
    };
    if (shouldRunElectronAsNode(nodeExecutable)) {
      launchEnv.ELECTRON_RUN_AS_NODE = '1';
    }
    const dshHome = (launchEnv as Record<string, string | undefined>).DSH_HOME;
    if (this.protocol === 'web' && dshHome) {
      const patchPath = path.resolve(this.cwd, this.configPath);
      const profilePatchPath = path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml');
      mkdirSync(path.dirname(profilePatchPath), { recursive: true });
      copyFileSync(patchPath, profilePatchPath);
      console.info('[robbot:dsh-process] projected web profile patch', { profilePatchPath });
    }
    console.info('[robbot:dsh-process] launch env summary', summarizeLaunchEnv(launchEnv));

    this.child = spawn(nodeExecutable, args, {
      cwd: this.cwd,
      stdio: 'pipe',
      env: launchEnv,
    });
    console.info('[robbot:dsh-process] DSH process spawned', {
      protocol: this.protocol,
      pid: this.child.pid,
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

    const child = this.child;
    const startedAt = Date.now();
    console.info('[robbot:dsh-process] stopping DSH process', { protocol: this.protocol, pid: child.pid });
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(killTimer);
        resolve();
      };
      const killTimer = setTimeout(() => {
        console.warn('[robbot:dsh-process] DSH process did not exit after SIGTERM; sending SIGKILL', {
          protocol: this.protocol,
          pid: child.pid,
        });
        child.kill('SIGKILL');
      }, 5_000);

      child.once('exit', finish);
      child.kill('SIGTERM');
    });
    console.info('[robbot:dsh-process] stopped DSH process', {
      protocol: this.protocol,
      pid: child.pid,
      elapsedMs: Date.now() - startedAt,
    });
    this.child = undefined;
    this.channel = undefined;
  }
}

function summarizeLaunchEnv(env: Record<string, string | undefined>): Record<string, unknown> {
  return {
    provider: env.ROBBOT_OPENAI_PROVIDER,
    openaiModel: env.ROBBOT_OPENAI_MODEL,
    deepseekModel: env.ROBBOT_DEEPSEEK_MODEL,
    dshModel: env.DSH_MODEL,
    permissionMode: env.DSH_PERMISSION_MODE,
    configPath: env.DSH_CORDIS_CONFIG,
    hasOpenaiApiKey: Boolean(env.OPENAI_API_KEY),
    hasOpenaiBaseUrl: Boolean(env.OPENAI_BASE_URL),
    hasDeepseekApiKey: Boolean(env.DEEPSEEK_API_KEY),
    hasDeepseekBaseUrl: Boolean(env.DEEPSEEK_BASE_URL),
    hasTsxTsconfigPath: Boolean(env.TSX_TSCONFIG_PATH),
  };
}

export function readRobbotEnvValueFromDshRoot(dshRoot: string, name: string): string | undefined {
  return readRobbotEnvFromDshRoot(dshRoot)[name];
}

function resolveNodeExecutable(): string {
  if (!isElectronRuntime() || !isPackagedDshRuntime()) {
    return process.execPath;
  }

  for (const candidate of [
    process.env.ROBBOT_NODE_EXECUTABLE,
    process.env.NODE_BINARY,
    packagedNodeExecutable(),
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

function packagedNodeExecutable(): string | undefined {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) {
    return undefined;
  }

  return path.join(resourcesPath, 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
}

function isPackagedDshRuntime(): boolean {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return Boolean(resourcesPath && existsSync(path.join(resourcesPath, 'dsh-runtime', 'lib', 'bin.js')));
}

function shouldRunElectronAsNode(nodeExecutable: string): boolean {
  return isElectronRuntime() && path.resolve(nodeExecutable) === path.resolve(process.execPath);
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

function isBuiltCliRuntime(cwd: string): boolean {
  try {
    accessSync(path.join(cwd, 'lib/bin.js'), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function builtCliArgs(
  cwd: string,
  protocol: DshProcessProtocol,
  bin: string,
  configPath: string,
  envOverrides: Record<string, string | undefined>,
): string[] {
  const nodeFlags = shouldExposeInternalsForLocalBuiltRuntime(cwd) ? ['--expose-internals'] : [];
  if (protocol === 'web') {
    return [...nodeFlags, bin, 'web', '--host', '127.0.0.1', '--port', envPort(envOverrides), '--no-open'];
  }
  if (protocol === 'sdk') {
    return [...nodeFlags, bin, configPath];
  }
  return [...nodeFlags, bin, '--config', configPath];
}

function envPort(env: Record<string, string | undefined>): string {
  return env.ROBBOT_DSH_WEB_PORT ?? '3187';
}

function shouldExposeInternalsForLocalBuiltRuntime(cwd: string): boolean {
  const normalized = path.normalize(cwd);
  return normalized.endsWith(path.join('apps', 'desktop', '.runtime', 'dsh'));
}

function readRobbotEnvFromDshRoot(dshRoot: string): Record<string, string> {
  // Local-development fallback only. Do not treat .env as the product runtime
  // source of truth when Electron/SQLite account AI config is available.
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
