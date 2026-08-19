import type { ApprovalInput } from './approval.js';
import type { HarnessEvent } from './harness-event.js';
import type { CreateSessionInput, HarnessSession, RunInput } from './harness-session.js';

export interface LocalHarness {
  createSession(input: CreateSessionInput): Promise<HarnessSession>;
  run(sessionId: string, input: RunInput): AsyncIterable<HarnessEvent>;
  interrupt(sessionId: string): Promise<void>;
  approve(sessionId: string, input: ApprovalInput): Promise<void>;
  dispose(): Promise<void>;
}
