import { DshLocalHarness, DshRuntimeManager, type DshRuntimeStatus } from '@robbot/dsh-adapter';
import type { HarnessEvent } from '@robbot/core';
import path from 'node:path';

export interface HarnessRuntimeStatus {
  status: DshRuntimeStatus;
  runtimeRoot: string;
}

export interface HarnessRunResult {
  sessionId: string;
  text: string;
  events: HarnessEvent[];
}

export interface HarnessLogEntry {
  at: string;
  source: 'renderer' | 'main' | 'harness' | 'dsh';
  message: string;
  data?: Record<string, unknown>;
}

export type HarnessLogSink = (entry: HarnessLogEntry) => void;

export class HarnessService {
  private readonly runtimeManager = new DshRuntimeManager();
  private readonly harness = new DshLocalHarness({ runtimeManager: this.runtimeManager });
  private logSink?: HarnessLogSink;

  setLogSink(logSink: HarnessLogSink | undefined): void {
    this.logSink = logSink;
  }

  getStatus(): HarnessRuntimeStatus {
    this.log('main', 'getStatus requested');
    const runtime = this.runtimeManager.resolveRuntime();
    const status = this.runtimeManager.status();

    this.log('main', 'runtime status resolved', {
      status,
      runtimeRoot: runtime.root,
    });

    return {
      status,
      runtimeRoot: runtime.root,
    };
  }

  async runPrompt(prompt: string): Promise<HarnessRunResult> {
    this.log('main', 'runPrompt requested', {
      promptLength: prompt.length,
    });

    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      this.log('main', 'runPrompt rejected: empty prompt');
      throw new Error('Prompt is required.');
    }

    const workspacePath = path.resolve(process.cwd(), '../..');
    this.log('harness', 'creating DSH ACP session', { workspacePath });
    const session = await this.harness.createSession({ workspacePath });
    this.log('harness', 'DSH ACP session created', { sessionId: session.id });

    const events: HarnessEvent[] = [];
    let text = '';

    this.log('harness', 'sending prompt to DSH ACP', { sessionId: session.id });
    for await (const event of this.harness.run(session.id, { prompt: normalizedPrompt })) {
      events.push(event);
      this.log('dsh', `event: ${event.type}`, summarizeHarnessEvent(event));
      if (event.type === 'assistant.delta') {
        text += event.text;
      }
      if (event.type === 'run.failed') {
        this.log('harness', 'DSH run failed', {
          sessionId: session.id,
          message: event.error.message,
          code: event.error.code,
        });
        throw new Error(event.error.message);
      }
    }

    this.log('harness', 'DSH run completed', {
      sessionId: session.id,
      eventCount: events.length,
      textLength: text.length,
    });

    return {
      sessionId: session.id,
      text,
      events,
    };
  }

  async dispose(): Promise<void> {
    this.log('main', 'disposing HarnessService');
    await this.harness.dispose();
  }

  private log(source: HarnessLogEntry['source'], message: string, data?: Record<string, unknown>): void {
    const entry: HarnessLogEntry = {
      at: new Date().toISOString(),
      source,
      message,
      data,
    };

    console.info(`[robbot:${source}] ${message}`, data ?? '');
    this.logSink?.(entry);
  }
}

function summarizeHarnessEvent(event: HarnessEvent): Record<string, unknown> {
  if (event.type === 'assistant.delta') {
    return {
      textLength: event.text.length,
      preview: event.text.slice(0, 80),
    };
  }

  if (event.type === 'run.failed') {
    return {
      message: event.error.message,
      code: event.error.code,
    };
  }

  if (event.type === 'approval.required') {
    return {
      approvalId: event.approval.id,
      title: event.approval.title,
    };
  }

  return { ...event };
}
