import { DshLocalHarness } from '@robbot/dsh-adapter';
import type { HarnessEvent } from '@robbot/core';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('LocalHarness.run streams a real DSH ACP prompt', { skip: !hasDeepSeekApiKey() }, async () => {
  const workspacePath = await mkdtemp(path.join(tmpdir(), 'robbot-dsh-run-'));
  const harness = new DshLocalHarness();

  try {
    const session = await withTimeout(
      harness.createSession({ workspacePath }),
      60_000,
      'Timed out waiting for DSH session/new.',
    );
    const events = await withTimeout(
      collect(harness.run(session.id, { prompt: 'Reply exactly: ROBBOT_ACP_OK' })),
      180_000,
      'Timed out waiting for DSH session/prompt.',
    );

    assertStreamingContract(events);
    assert.ok(events.some((event) => event.type === 'assistant.delta' && event.text.length > 0));
    assert.ok(events.some((event) => event.type === 'run.completed'));
  } finally {
    await harness.dispose();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

export function assertStreamingContract(events: HarnessEvent[]): void {
  if (!events.some((event) => event.type === 'run.started')) {
    throw new Error('Expected run.started event.');
  }
}

async function collect(events: AsyncIterable<HarnessEvent>): Promise<HarnessEvent[]> {
  const collected: HarnessEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

function hasDeepSeekApiKey(): boolean {
  if (process.env.DEEPSEEK_API_KEY) {
    return true;
  }

  let contents: string;
  try {
    contents = readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
  } catch {
    return false;
  }

  return contents
    .split(/\r?\n/)
    .some((rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        return false;
      }
      const separator = line.indexOf('=');
      return separator > 0
        && line.slice(0, separator).trim() === 'DEEPSEEK_API_KEY'
        && line.slice(separator + 1).trim().length > 0;
    });
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
