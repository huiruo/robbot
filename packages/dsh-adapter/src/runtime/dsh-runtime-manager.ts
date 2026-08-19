import { HarnessError } from '@robbot/core';

import { DshProcess } from '../transport/process/dsh-process.js';
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

  async start(sessionId: string): Promise<DshProcess> {
    await this.verifyRuntime();
    const existing = this.processes.get(sessionId);
    if (existing) {
      return existing;
    }

    const runtime = this.resolveRuntime();
    const processHandle = new DshProcess(
      runtime.root,
      process.env.ROBBOT_DSH_CONFIG ?? runtime.config.configPath,
    );
    await processHandle.start();
    this.processes.set(sessionId, processHandle);
    return processHandle;
  }

  async stop(sessionId: string): Promise<void> {
    const processHandle = this.processes.get(sessionId);
    if (!processHandle) {
      return;
    }

    await processHandle.stop();
    this.processes.delete(sessionId);
  }

  async restart(sessionId: string): Promise<DshProcess> {
    await this.stop(sessionId);
    return this.start(sessionId);
  }

  status(sessionId?: string): DshRuntimeStatus {
    if (!this.resolver.isRuntimeCheckoutPresent()) {
      return 'missing';
    }
    if (!this.resolver.isRuntimeInstalled()) {
      return 'not_installed';
    }
    if (sessionId && this.processes.has(sessionId)) {
      return 'running';
    }
    return 'ready';
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.processes.keys()].map((sessionId) => this.stop(sessionId)));
  }
}
