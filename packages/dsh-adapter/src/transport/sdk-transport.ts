import type { ApprovalInput, CreateSessionInput, HarnessEvent, HarnessSession, RunInput } from '@robbot/core';
import { HarnessError } from '@robbot/core';
import { randomUUID } from 'node:crypto';

import { mapSdkNotificationToHarnessEvents } from '../mapper/sdk-event-mapper.js';
import type { DshRuntimeManager } from '../runtime/dsh-runtime-manager.js';
import type { StdioChannel } from './process/stdio-channel.js';
import type { HarnessTransport } from './transport.js';

type JsonRpcId = number | string;

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { message?: string; code?: number | string };
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

interface SdkSession {
  id: string;
  workspacePath: string;
  processKey: string;
  channel: StdioChannel;
}

interface SdkRunState {
  runId: string;
  sessionId: string;
  promptMessageId?: string;
  sawTurnEnd: boolean;
  turnEndKind?: string;
  idle: boolean;
}

export class SdkTransport implements HarnessTransport {
  readonly mode = 'sdk' as const;
  private nextId = 1;
  private readonly sessions = new Map<string, SdkSession>();
  private readonly initializedByProcessKey = new Map<string, Promise<StdioChannel>>();
  private readonly channelByProcessKey = new Map<string, StdioChannel>();
  private readonly pendingByProcessKey = new Map<string, Map<JsonRpcId, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>>();
  private readonly eventQueues = new Map<string, AsyncEventQueue<HarnessEvent>>();
  private readonly runStates = new Map<string, SdkRunState>();

  constructor(private readonly runtimeManager: DshRuntimeManager) {}

  capabilities() {
    return {
      streaming: 'runtime-events' as const,
      toolEvents: true,
      cancelCurrentRun: false,
      approval: false,
      sessionResume: true,
    };
  }

  async createSession(input: CreateSessionInput): Promise<HarnessSession> {
    const id = stableSessionId(input);
    const processKey = `workspace:${input.workspacePath}`;
    const channel = await this.ensureInitialized(processKey, input.workspacePath);
    this.sessions.set(id, {
      id,
      workspacePath: input.workspacePath,
      processKey,
      channel,
    });

    return {
      id,
      workspacePath: input.workspacePath,
      createdAt: new Date().toISOString(),
      metadata: input.metadata,
    };
  }

  async *run(sessionId: string, input: RunInput): AsyncIterable<HarnessEvent> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new HarnessError(`Unknown SDK session: ${sessionId}`, 'protocol_error');
    }

    const runId = randomUUID();
    const queue = this.getQueue(sessionId);
    const state: SdkRunState = {
      runId,
      sessionId,
      sawTurnEnd: false,
      idle: false,
    };

    this.runStates.set(sessionId, state);
    yield { type: 'run.started', runId, sessionId };

    try {
      const receipt = await this.request<{ messageId: string }>(session.processKey, 'session/prompt', {
        sessionId,
        contentBlocks: [{ type: 'text', text: input.prompt }],
      });
      state.promptMessageId = receipt.messageId;

      while (!state.sawTurnEnd || !state.idle) {
        const event = await queue.shift();
        if (event) {
          yield event;
        }
      }

      if (!state.turnEndKind || state.turnEndKind === 'completed') {
        yield { type: 'run.completed', runId };
      } else {
        yield {
          type: 'run.failed',
          runId,
          error: {
            code: state.turnEndKind,
            message: `DSH SDK turn ended with reason: ${state.turnEndKind}`,
          },
        };
      }
    } catch (error) {
      yield {
        type: 'run.failed',
        runId,
        error: {
          code: 'protocol_error',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    } finally {
      this.runStates.delete(sessionId);
    }
  }

  async cancel(_sessionId: string): Promise<void> {
    throw new HarnessError('DSH SDK transport does not support per-session cancel yet.', 'unsupported_capability');
  }

  async approve(_sessionId: string, _input: ApprovalInput): Promise<void> {
    throw new HarnessError('DSH SDK transport does not support approval responses yet.', 'unsupported_capability');
  }

  async terminateAll(): Promise<void> {
    await this.runtimeManager.stopAll();
    for (const queue of this.eventQueues.values()) {
      queue.push({
        type: 'run.interrupted',
        error: { code: 'runtime_terminated', message: 'DSH SDK runtime was terminated.' },
      });
    }
    this.sessions.clear();
    this.initializedByProcessKey.clear();
    this.channelByProcessKey.clear();
    this.pendingByProcessKey.clear();
    this.runStates.clear();
  }

  private async ensureInitialized(processKey: string, workspacePath: string): Promise<StdioChannel> {
    const existing = this.initializedByProcessKey.get(processKey);
    if (existing) {
      return existing;
    }

    const initialized = this.connectAndInitialize(processKey, workspacePath);
    this.initializedByProcessKey.set(processKey, initialized);
    return initialized;
  }

  private async connectAndInitialize(processKey: string, workspacePath: string): Promise<StdioChannel> {
    const runtime = this.runtimeManager.resolveRuntime();
    const processHandle = await this.runtimeManager.start(processKey, 'sdk', {
      DSH_CWD: workspacePath,
      DSH_MODEL: runtime.config.model ?? 'deepseek-v4-flash',
      DSH_SESSION_ROOT: `${workspacePath}/.robbot/dsh-sessions`,
    });
    const channel = processHandle.getChannel();
    this.channelByProcessKey.set(processKey, channel);
    this.pendingByProcessKey.set(processKey, new Map());
    channel.onMessage((message) => this.handleMessage(processKey, message));
    await this.request(processKey, 'initialize', {
      cwd: workspacePath,
      provider: runtime.config.provider ?? 'deepseek-official',
      model: runtime.config.model ?? 'deepseek-v4-flash',
    });
    return channel;
  }

  private request<T = unknown>(processKey: string, method: string, params?: unknown): Promise<T> {
    const session = [...this.sessions.values()].find((item) => item.processKey === processKey);
    const channel = session?.channel ?? this.channelByProcessKey.get(processKey);
    const pending = this.pendingByProcessKey.get(processKey);
    if (!pending) {
      throw new HarnessError('DSH SDK transport is not connected.', 'transport_error');
    }

    const id = this.nextId++;
    const response = new Promise<T>((resolve, reject) => {
      pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
    });

    if (!channel) {
      pending.delete(id);
      throw new HarnessError('DSH SDK transport channel is not connected.', 'transport_error');
    }

    channel.send({ jsonrpc: '2.0', id, method, params });
    return response;
  }

  private handleMessage(processKey: string, message: JsonRpcResponse | JsonRpcRequest): void {
    if ('id' in message && message.id !== undefined && ('result' in message || 'error' in message)) {
      const pending = this.pendingByProcessKey.get(processKey)?.get(message.id);
      if (!pending) {
        return;
      }

      this.pendingByProcessKey.get(processKey)?.delete(message.id);
      if (message.error) {
        pending.reject(new HarnessError(message.error.message ?? 'DSH SDK request failed.', 'protocol_error', message.error));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!('method' in message)) {
      return;
    }

    this.handleNotification(message.method, message.params);
  }

  private handleNotification(method: string, params: unknown): void {
    const sessionId = notificationSessionId(params);
    if (!sessionId) {
      return;
    }

    const state = this.runStates.get(sessionId);
    if (method === 'session.event' && state) {
      const event = asRecord(asRecord(params)?.event);
      if (event?.type === 'turn/end') {
        state.turnEndKind = turnEndKind(event);
      }
    }

    if (method === 'session.status' && state) {
      const status = asRecord(params)?.status;
      if (status === 'idle') {
        state.idle = true;
        this.getQueue(sessionId).push(undefined);
      }
      return;
    }

    for (const mapped of mapSdkNotificationToHarnessEvents(method, params)) {
      if (state) {
        state.sawTurnEnd ||= mapped.sawTurnEnd === true;
      }

      if (mapped.sawTurnStart || mapped.sawTurnEnd) {
        this.getQueue(sessionId).push(undefined);
        continue;
      }

      this.getQueue(sessionId).push(mapped.event);
    }
  }

  private getQueue(sessionId: string): AsyncEventQueue<HarnessEvent> {
    let queue = this.eventQueues.get(sessionId);
    if (!queue) {
      queue = new AsyncEventQueue<HarnessEvent>();
      this.eventQueues.set(sessionId, queue);
    }
    return queue;
  }
}

function stableSessionId(input: CreateSessionInput): string {
  return typeof input.metadata?.robbotSessionId === 'string' ? input.metadata.robbotSessionId : randomUUID();
}

function notificationSessionId(params: unknown): string | undefined {
  const value = asRecord(params)?.sessionId;
  return typeof value === 'string' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function turnEndKind(event: Record<string, unknown>): string | undefined {
  const reason = asRecord(asRecord(event.data)?.reason);
  return typeof reason?.kind === 'string' ? reason.kind : undefined;
}

class AsyncEventQueue<T> {
  private readonly values: Array<T | undefined> = [];
  private readonly waiters: Array<(value: T | undefined) => void> = [];

  push(value: T | undefined): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(value);
      return;
    }
    this.values.push(value);
  }

  async shift(): Promise<T | undefined> {
    if (this.values.length > 0) {
      return this.values.shift();
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}
