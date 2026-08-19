import type { ApprovalInput, CreateSessionInput, HarnessEvent, HarnessSession, RunInput } from '@robbot/core';

export interface HarnessTransport {
  createSession(input: CreateSessionInput): Promise<HarnessSession>;
  run(sessionId: string, input: RunInput): AsyncIterable<HarnessEvent>;
  cancel(sessionId: string): Promise<void>;
  approve(sessionId: string, input: ApprovalInput): Promise<void>;
}
