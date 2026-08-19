import type { ApprovalInput, CreateSessionInput, HarnessEvent, HarnessSession, LocalHarness, RunInput } from '@robbot/core';
import { HarnessError } from '@robbot/core';

import { DshRuntimeManager } from './runtime/dsh-runtime-manager.js';
import { AcpTransport } from './transport/acp-transport.js';

export interface DshLocalHarnessOptions {
  runtimeManager?: DshRuntimeManager;
  transport?: AcpTransport;
}

export class DshLocalHarness implements LocalHarness {
  private readonly runtimeManager: DshRuntimeManager;
  private readonly transport: AcpTransport;

  constructor(options: DshLocalHarnessOptions = {}) {
    this.runtimeManager = options.runtimeManager ?? new DshRuntimeManager();
    this.transport = options.transport ?? new AcpTransport(this.runtimeManager);
  }

  async createSession(input: CreateSessionInput): Promise<HarnessSession> {
    await this.runtimeManager.verifyRuntime();
    return this.transport.createSession(input);
  }

  run(sessionId: string, input: RunInput): AsyncIterable<HarnessEvent> {
    return this.transport.run(sessionId, input);
  }

  async interrupt(sessionId: string): Promise<void> {
    try {
      await this.transport.cancel(sessionId);
    } catch (error) {
      await this.runtimeManager.stopAll();
      throw new HarnessError('DSH ACP cancel failed; terminated runtime process as fallback.', 'run_interrupted', error);
    }
  }

  async approve(sessionId: string, input: ApprovalInput): Promise<void> {
    await this.transport.approve(sessionId, input);
  }

  async dispose(): Promise<void> {
    await this.runtimeManager.stopAll();
  }
}
