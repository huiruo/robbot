import { HarnessError } from '@robbot/core';

import { DshProcess } from '../transport/process/dsh-process.js';
import type { DshProcessProtocol } from '../transport/process/dsh-process.js';
import { DshRuntimeResolver, type ResolvedDshRuntime } from './dsh-runtime-resolver.js';

export type DshRuntimeStatus = 'missing' | 'not_installed' | 'ready' | 'running';

export class DshRuntimeManager {
  private readonly processes = new Map<string, DshProcess>();

  constructor(private readonly resolver = new DshRuntimeResolver()) {}

  resolveRuntime(): ResolvedDshRuntime {
    return this.resolver.resolveRuntime();
  }

  async verifyRuntime(): Promise<void> {
    if (!this.resolver.isRuntimeCheckoutPresent()) {
      throw new HarnessError('DSH submodule is missing. Run: git submodule update --init --recursive', 'runtime_not_found');
    }

    if (!this.resolver.isRuntimeInstalled()) {
      throw new HarnessError('DSH runtime is not installed or built. Run: pnpm dsh:setup', 'runtime_not_ready');
    }
  }

  async start(
    sessionId: string,
    protocol?: DshProcessProtocol,
    envOverrides: Record<string, string | undefined> = {},
  ): Promise<DshProcess> {
    await this.verifyRuntime();
    const runtime = this.resolveRuntime();
    const selectedProtocol = protocol ?? runtime.config.protocol;
    const processKey = `${selectedProtocol}:${sessionId}`;
    const existing = this.processes.get(processKey);
    if (existing) {
      return existing;
    }

    const processHandle = new DshProcess(
      runtime.root,
      selectedProtocol,
      process.env.ROBBOT_DSH_CONFIG ?? configPathForProtocol(selectedProtocol, runtime.config.protocol, runtime.config.configPath),
      envOverrides,
    );
    await processHandle.start();
    this.processes.set(processKey, processHandle);
    return processHandle;
  }

  async stop(sessionId: string, protocol?: DshProcessProtocol): Promise<void> {
    const runtime = this.resolveRuntime();
    const selectedProtocol = protocol ?? runtime.config.protocol;
    const processKey = `${selectedProtocol}:${sessionId}`;
    const processHandle = this.processes.get(processKey);
    if (!processHandle) {
      return;
    }

    await processHandle.stop();
    this.processes.delete(processKey);
  }

  async restart(sessionId: string, protocol?: DshProcessProtocol): Promise<DshProcess> {
    await this.stop(sessionId, protocol);
    return this.start(sessionId, protocol);
  }

  status(sessionId?: string): DshRuntimeStatus {
    if (!this.resolver.isRuntimeCheckoutPresent()) {
      return 'missing';
    }
    if (!this.resolver.isRuntimeInstalled()) {
      return 'not_installed';
    }
    if (sessionId && (this.processes.has(`sdk:${sessionId}`) || this.processes.has(`acp:${sessionId}`))) {
      return 'running';
    }
    return 'ready';
  }

  async stopAll(): Promise<void> {
    const entries = [...this.processes.entries()];
    await Promise.all(entries.map(async ([processKey, processHandle]) => {
      await processHandle.stop();
      this.processes.delete(processKey);
    }));
  }
}

function configPathForProtocol(protocol: DshProcessProtocol, configuredProtocol: DshProcessProtocol, configuredPath: string): string {
  if (protocol === configuredProtocol) {
    return configuredPath;
  }

  return protocol === 'sdk' ? '../../config/dsh-sdk-flash.cordis.yml' : '../../config/dsh-acp-flash.cordis.yml';
}
