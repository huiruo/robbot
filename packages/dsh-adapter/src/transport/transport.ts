import type { ApprovalInput, CreateSessionInput, HarnessCapabilities, HarnessEvent, HarnessRunMode, HarnessSession, RunInput } from '@robbot/core';

export type DshRunMode = HarnessRunMode;

export interface HarnessTransport {
  readonly mode: DshRunMode;
  capabilities(): HarnessCapabilities;
  createSession(input: CreateSessionInput): Promise<HarnessSession>;
  run(sessionId: string, input: RunInput): AsyncIterable<HarnessEvent>;
  cancel(sessionId: string): Promise<void>;
  approve(sessionId: string, input: ApprovalInput): Promise<void>;
}
