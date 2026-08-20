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
  promptAccepted: boolean;
  pendingNotifications: Array<{ method: string; params: unknown }>;
  sawTurnEnd: boolean;
  turnEndReason?: SdkTurnEndReason;
  idle: boolean;
}

interface SdkTurnEndReason {
  kind?: string;
  error?: {
    message?: string;
    code?: string;
  };
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
      sessionResume: false,
    };
  }

  async createSession(input: CreateSessionInput): Promise<HarnessSession> {
    const id = randomUUID();
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
      promptAccepted: false,
      pendingNotifications: [],
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
      for (const notification of state.pendingNotifications.splice(0)) {
        this.handleNotification(notification.method, notification.params);
      }

      while (!state.promptAccepted || !state.sawTurnEnd || !state.idle) {
        const event = await queue.shift();
        if (event) {
          yield event;
        }
      }

      if (!state.turnEndReason?.kind || state.turnEndReason.kind === 'completed') {
        yield { type: 'run.completed', runId };
      } else {
        const error = errorFromTurnEndReason(state.turnEndReason);
        yield {
          type: 'run.failed',
          runId,
          error,
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
    if (state && !state.promptMessageId && (method === 'session.event' || method === 'session.status')) {
      state.pendingNotifications.push({ method, params });
      return;
    }

    if (method === 'session.event' && state) {
      const event = asRecord(asRecord(params)?.event);
      if (!state.promptAccepted && isInboxReceipt(event, state.promptMessageId)) {
        state.promptAccepted = true;
        this.getQueue(sessionId).push(undefined);
        return;
      }

      if (!state.promptAccepted) {
        return;
      }

      if (event?.type === 'turn/end') {
        state.turnEndReason = turnEndReason(event);
        if (state.turnEndReason?.kind === 'error') {
          console.warn('[robbot:dsh-sdk] turn ended with error', {
            sessionId,
            code: state.turnEndReason.error?.code ?? state.turnEndReason.kind,
            message: summarizeForLog(state.turnEndReason.error?.message),
          });
        }
      } else if (event?.type === 'llm/retry') {
        console.warn('[robbot:dsh-sdk] llm retry', {
          sessionId,
          event: summarizeForLog(event),
        });
      }
    }

    if (method === 'session.status' && state) {
      if (!state.promptAccepted) {
        return;
      }

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

function notificationSessionId(params: unknown): string | undefined {
  const value = asRecord(params)?.sessionId;
  return typeof value === 'string' ? value : undefined;
}

function isInboxReceipt(event: Record<string, unknown> | undefined, messageId: string | undefined): boolean {
  if (!event || event.type !== 'agent/inbox/spliced' || !messageId) {
    return false;
  }

  const inserted = asRecord(event.data)?.inserted;
  return Array.isArray(inserted)
    && inserted.some((message) => asRecord(message)?.id === messageId);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function turnEndReason(event: Record<string, unknown>): SdkTurnEndReason | undefined {
  const reason = asRecord(asRecord(event.data)?.reason);
  if (!reason) {
    return undefined;
  }

  const error = asRecord(reason.error);
  return {
    kind: typeof reason.kind === 'string' ? reason.kind : undefined,
    error: error
      ? {
          message: typeof error.message === 'string' ? error.message : undefined,
          code: typeof error.code === 'string' ? error.code : undefined,
        }
      : undefined,
  };
}

function errorFromTurnEndReason(reason: SdkTurnEndReason): { message: string; code?: string } {
  const code = reason.error?.code ?? reason.kind ?? 'unknown_turn_end_reason';
  const message = reason.error?.message
    ?? `DSH SDK turn ended with reason: ${reason.kind ?? 'unknown'}`;
  return { code, message };
}

function summarizeForLog(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }

  if (value && typeof value === 'object') {
    const summary = JSON.stringify(value, (_key, child) => {
      if (typeof child === 'string' && child.length > 500) {
        return `${child.slice(0, 500)}...`;
      }
      return child;
    });
    return summary.length > 1000 ? `${summary.slice(0, 1000)}...` : summary;
  }

  return value;
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
