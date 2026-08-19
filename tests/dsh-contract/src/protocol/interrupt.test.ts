import type { LocalHarness } from '@robbot/core';

export async function interruptContract(harness: LocalHarness, sessionId: string): Promise<void> {
  await harness.interrupt(sessionId);
}
