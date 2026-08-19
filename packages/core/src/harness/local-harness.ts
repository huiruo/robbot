import type { ApprovalInput } from './approval.js';
import type { HarnessEvent } from './harness-event.js';
import type { CreateSessionInput, HarnessSession, RunInput } from './harness-session.js';

export type HarnessStreamingCapability = 'none' | 'committed-message' | 'runtime-events';
export type HarnessRunMode = 'sdk' | 'acp';

export interface HarnessCapabilities {
  streaming: HarnessStreamingCapability;
  toolEvents: boolean;
  cancelCurrentRun: boolean;
  approval: boolean;
  sessionResume: boolean;
}

export interface LocalHarness {
  capabilities(runMode?: HarnessRunMode): HarnessCapabilities;
  createSession(input: CreateSessionInput): Promise<HarnessSession>;
  run(sessionId: string, input: RunInput): AsyncIterable<HarnessEvent>;
  interrupt(sessionId: string): Promise<void>;
  approve(sessionId: string, input: ApprovalInput): Promise<void>;
  dispose(): Promise<void>;
}
