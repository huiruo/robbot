import type { ApprovalInput, CreateSessionInput, HarnessCapabilities, HarnessEvent, HarnessRunMode, HarnessSession, LocalHarness, RunInput } from '@robbot/core';
import { HarnessError } from '@robbot/core';

import { DshRuntimeManager } from './runtime/dsh-runtime-manager.js';
import { AcpTransport } from './transport/acp-transport.js';
import { SdkTransport } from './transport/sdk-transport.js';
import type { HarnessTransport } from './transport/transport.js';

export interface DshLocalHarnessOptions {
  runtimeManager?: DshRuntimeManager;
  sdkTransport?: SdkTransport;
  acpTransport?: AcpTransport;
}

export class DshLocalHarness implements LocalHarness {
  private readonly runtimeManager: DshRuntimeManager;
  private readonly sdkTransport: SdkTransport;
  private readonly acpTransport: AcpTransport;
  private readonly sessionModes = new Map<string, HarnessRunMode>();

  constructor(options: DshLocalHarnessOptions = {}) {
    this.runtimeManager = options.runtimeManager ?? new DshRuntimeManager();
    this.sdkTransport = options.sdkTransport ?? new SdkTransport(this.runtimeManager);
    this.acpTransport = options.acpTransport ?? new AcpTransport(this.runtimeManager);
  }

  capabilities(runMode?: HarnessRunMode): HarnessCapabilities {
    return this.transportForMode(runMode ?? this.defaultRunMode()).capabilities();
  }

  async warmup(input: CreateSessionInput): Promise<void> {
    await this.runtimeManager.verifyRuntime();
    const runMode = normalizeRunMode(input.metadata?.runMode, this.defaultRunMode());
    await this.transportForMode(runMode).warmup(input);
  }

  async createSession(input: CreateSessionInput): Promise<HarnessSession> {
    await this.runtimeManager.verifyRuntime();
    const runMode = normalizeRunMode(input.metadata?.runMode, this.defaultRunMode());
    const session = await this.transportForMode(runMode).createSession(input);
    this.sessionModes.set(session.id, runMode);
    return session;
  }

  run(sessionId: string, input: RunInput): AsyncIterable<HarnessEvent> {
    return this.transportForSession(sessionId, input.metadata?.runMode).run(sessionId, input);
  }

  async interrupt(sessionId: string): Promise<void> {
    const transport = this.transportForSession(sessionId);
    if (!transport.capabilities().cancelCurrentRun) {
      throw new HarnessError('This DSH transport does not support per-session cancel.', 'unsupported_capability');
    }

    try {
      await transport.cancel(sessionId);
    } catch (error) {
      throw new HarnessError('DSH cancel failed.', 'run_interrupted', error);
    }
  }

  async terminate(sessionId: string): Promise<void> {
    const transport = this.transportForSession(sessionId);
    await transport.terminate(sessionId);
    this.sessionModes.delete(sessionId);
  }

  async approve(sessionId: string, input: ApprovalInput): Promise<void> {
    const transport = this.transportForSession(sessionId);
    if (!transport.capabilities().approval) {
      throw new HarnessError('This DSH transport does not support approval responses.', 'unsupported_capability');
    }

    await transport.approve(sessionId, input);
  }

  async dispose(): Promise<void> {
    await this.runtimeManager.stopAll();
  }

  private defaultRunMode(): HarnessRunMode {
    return this.runtimeManager.resolveRuntime().config.protocol;
  }

  private transportForSession(sessionId: string, requestedMode?: unknown): HarnessTransport {
    return this.transportForMode(normalizeRunMode(requestedMode, this.sessionModes.get(sessionId) ?? this.defaultRunMode()));
  }

  private transportForMode(runMode: HarnessRunMode): HarnessTransport {
    return runMode === 'acp' ? this.acpTransport : this.sdkTransport;
  }
}

function normalizeRunMode(value: unknown, fallback: HarnessRunMode): HarnessRunMode {
  return value === 'acp' || value === 'sdk' ? value : fallback;
}
