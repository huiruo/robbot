import type { ApprovalInput, ApprovalRequest, CreateSessionInput, HarnessEvent, HarnessSession, RunInput } from '@robbot/core';
import { HarnessError } from '@robbot/core';
import { randomUUID } from 'node:crypto';

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

interface PendingPermission {
  rpcId: JsonRpcId;
  allowOptionId?: string;
  rejectOptionId?: string;
}

export class AcpTransport implements HarnessTransport {
  readonly mode = 'acp' as const;
  private channel?: StdioChannel;
  private initialized?: Promise<void>;
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private readonly eventQueues = new Map<string, AsyncEventQueue<HarnessEvent>>();
  private readonly permissions = new Map<string, PendingPermission>();

  constructor(private readonly runtimeManager: DshRuntimeManager) {}

  capabilities() {
    return {
      streaming: 'committed-message' as const,
      toolEvents: false,
      cancelCurrentRun: true,
      approval: true,
      sessionResume: false,
    };
  }

  async createSession(input: CreateSessionInput): Promise<HarnessSession> {
    await this.ensureInitialized();
    const result = await this.request<{ sessionId: string }>('session/new', {
      cwd: input.workspacePath,
      mcpServers: [],
    });

    return {
      id: result.sessionId,
      workspacePath: input.workspacePath,
      createdAt: new Date().toISOString(),
      metadata: input.metadata,
    };
  }

  async *run(sessionId: string, input: RunInput): AsyncIterable<HarnessEvent> {
    await this.ensureInitialized();
    const runId = randomUUID();
    const queue = this.getQueue(sessionId);

    yield { type: 'run.started', runId, sessionId };

    const prompt = this.request<{ stopReason: string }>('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: input.prompt }],
    });

    let settled = false;
    let promptResult: { stopReason: string } | undefined;
    let promptError: unknown;
    prompt.then(
      (result) => {
        settled = true;
        promptResult = result;
        queue.push(undefined);
      },
      (error: unknown) => {
        settled = true;
        promptError = error;
        queue.push(undefined);
      },
    );

    while (!settled) {
      const event = await queue.shift();
      if (event) {
        yield event;
      }
    }

    if (promptError) {
      yield {
        type: 'run.failed',
        runId,
        error: {
          code: 'protocol_error',
          message: promptError instanceof Error ? promptError.message : String(promptError),
        },
      };
      return;
    }

    if (promptResult?.stopReason === 'end_turn') {
      yield { type: 'run.completed', runId };
      return;
    }

    yield {
      type: 'run.failed',
      runId,
      error: {
        code: promptResult?.stopReason ?? 'unknown_stop_reason',
        message: `DSH prompt stopped with reason: ${promptResult?.stopReason ?? 'unknown'}`,
      },
    };
  }

  async cancel(sessionId: string): Promise<void> {
    await this.ensureInitialized();
    await this.request('session/cancel', { sessionId });
  }

  async approve(_sessionId: string, input: ApprovalInput): Promise<void> {
    const permission = this.permissions.get(input.approvalId);
    if (!permission) {
      throw new HarnessError(`Unknown approval request: ${input.approvalId}`, 'protocol_error');
    }

    this.permissions.delete(input.approvalId);
    const optionId = input.approved ? permission.allowOptionId : permission.rejectOptionId;

    await this.respond(permission.rpcId, {
      outcome: optionId
        ? { outcome: 'selected', optionId }
        : { outcome: input.approved ? 'cancelled' : 'cancelled' },
    });
  }

  private async ensureInitialized(): Promise<void> {
    this.initialized ??= this.connectAndInitialize();
    await this.initialized;
  }

  private async connectAndInitialize(): Promise<void> {
    console.info('[robbot:acp] starting runtime');
    const processHandle = await this.runtimeManager.start('acp', 'acp');
    this.channel = processHandle.getChannel();
    this.attachReader(this.channel);
    console.info('[robbot:acp] sending initialize');
    await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
    });
    console.info('[robbot:acp] initialized');
  }

  private async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.channel) {
      throw new HarnessError('DSH ACP transport is not connected.', 'transport_error');
    }

    const id = this.nextId++;
    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const response = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
    });

    console.info('[robbot:acp] -> request', {
      id,
      method,
      params: summarizeRpcParams(params),
    });
    this.channel.send(message);
    return response;
  }

  private async respond(id: JsonRpcId, result: unknown): Promise<void> {
    if (!this.channel) {
      throw new HarnessError('DSH ACP transport is not connected.', 'transport_error');
    }

    this.channel.send({
      jsonrpc: '2.0',
      id,
      result,
    });
  }

  private attachReader(channel: StdioChannel): void {
    channel.onMessage((message) => this.handleMessage(message));
  }

  private handleMessage(message: JsonRpcResponse | JsonRpcRequest): void {
    if ('id' in message && message.id !== undefined && ('result' in message || 'error' in message)) {
      console.info('[robbot:acp] <- response', {
        id: message.id,
        ok: !message.error,
        error: message.error?.message,
      });

      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new HarnessError(message.error.message ?? 'DSH ACP request failed.', 'protocol_error', message.error));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!('method' in message)) {
      return;
    }

    console.info('[robbot:acp] <- notification/request', {
      id: message.id,
      method: message.method,
      params: summarizeRpcParams(message.params),
    });

    if (message.method === 'session/update') {
      this.handleSessionUpdate(message.params);
      return;
    }

    if (message.method === 'session/request_permission' && message.id !== undefined) {
      this.handlePermissionRequest(message.id, message.params);
    }
  }

  private handleSessionUpdate(params: unknown): void {
    const update = params as {
      sessionId?: string;
      update?: {
        sessionUpdate?: string;
        content?: { type?: string; text?: string };
      };
    };

    if (!update.sessionId || update.update?.sessionUpdate !== 'agent_message_chunk') {
      return;
    }

    if (update.update.content?.type === 'text' && update.update.content.text) {
      this.getQueue(update.sessionId).push({
        type: 'assistant.delta',
        text: update.update.content.text,
      });
    }
  }

  private handlePermissionRequest(rpcId: JsonRpcId, params: unknown): void {
    const request = params as {
      sessionId?: string;
      toolCall?: { toolCallId?: string };
      options?: Array<{ optionId: string; name?: string; kind?: string }>;
    };

    if (!request.sessionId) {
      void this.respond(rpcId, { outcome: { outcome: 'cancelled' } });
      return;
    }

    const approvalId = request.toolCall?.toolCallId ?? String(rpcId);
    this.permissions.set(approvalId, {
      rpcId,
      allowOptionId: request.options?.find((option) => option.kind === 'allow_once')?.optionId,
      rejectOptionId: request.options?.find((option) => option.kind === 'reject_once')?.optionId,
    });

    const approval: ApprovalRequest = {
      id: approvalId,
      sessionId: request.sessionId,
      title: 'DSH permission required',
      description: request.options?.map((option) => option.name ?? option.optionId).join(' / '),
      metadata: params as Record<string, unknown>,
    };

    this.getQueue(request.sessionId).push({ type: 'approval.required', approval });
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

function summarizeRpcParams(params: unknown): unknown {
  if (!params || typeof params !== 'object') {
    return params;
  }

  const value = params as Record<string, unknown>;
  const summary: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    if (key === 'prompt') {
      summary.prompt = Array.isArray(item) ? `[${item.length} item(s)]` : typeof item;
      continue;
    }

    if (key === 'content') {
      summary.content = summarizeContent(item);
      continue;
    }

    if (key === 'update') {
      summary.update = summarizeRpcParams(item);
      continue;
    }

    summary[key] = item;
  }

  return summary;
}

function summarizeContent(content: unknown): unknown {
  if (!content || typeof content !== 'object') {
    return content;
  }

  const value = content as { type?: unknown; text?: unknown };
  return {
    type: value.type,
    textLength: typeof value.text === 'string' ? value.text.length : undefined,
  };
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
