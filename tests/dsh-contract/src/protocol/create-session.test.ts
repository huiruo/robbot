import { DshLocalHarness } from '@robbot/dsh-adapter';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('LocalHarness.createSession creates a real DSH ACP session', async () => {
  const workspacePath = await mkdtemp(path.join(tmpdir(), 'robbot-dsh-session-'));
  const harness = new DshLocalHarness();

  try {
    const session = await withTimeout(
      harness.createSession({ workspacePath }),
      60_000,
      'Timed out waiting for DSH session/new.',
    );

    assert.equal(typeof session.id, 'string');
    assert.ok(session.id.length > 0);
    assert.equal(session.workspacePath, workspacePath);
  } finally {
    await harness.dispose();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

export async function createSessionContract(workspacePath: string): Promise<void> {
  const harness = new DshLocalHarness();
  const session = await harness.createSession({ workspacePath });

  if (!session.id) {
    throw new Error('Expected DSH session id.');
  }

  await harness.dispose();
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
