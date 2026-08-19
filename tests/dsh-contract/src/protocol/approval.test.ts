import type { LocalHarness } from '@robbot/core';

export async function approvalContract(harness: LocalHarness, sessionId: string, approvalId: string): Promise<void> {
  await harness.approve(sessionId, { approvalId, approved: true });
}
