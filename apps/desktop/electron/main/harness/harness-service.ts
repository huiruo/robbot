import { DshLocalHarness, DshRuntimeManager, type DshRuntimeStatus } from '@robbot/dsh-adapter';
import type { ApprovalInput, HarnessCapabilities, HarnessEvent, HarnessRunMode } from '@robbot/core';
import { randomUUID } from 'node:crypto';

import type { MessageRepository, SessionRepository, WorkspaceRepository } from '../../storage/repositories';

export interface HarnessRuntimeStatus {
  status: DshRuntimeStatus;
  runtimeRoot: string;
}

export interface HarnessRunInput {
  accountId: string;
  workspaceId: string;
  sessionId: string;
  prompt: string;
  runMode?: HarnessRunMode;
}

export interface HarnessRunStartResult {
  runId: string;
  userMessageId: string;
  assistantMessageId: string;
  harnessSessionId: string;
  runMode: HarnessRunMode;
}

export interface HarnessLogEntry {
  at: string;
  source: 'renderer' | 'main' | 'harness' | 'dsh';
  message: string;
  data?: Record<string, unknown>;
}

export type HarnessLogSink = (entry: HarnessLogEntry) => void;
export type HarnessEventSink = (event: HarnessUiEvent) => void;

export type ActiveRunStatus = 'running' | 'waiting_approval' | 'cancelling';

export interface ActiveRun {
  runId: string;
  runMode: HarnessRunMode;
  accountId: string;
  robbotSessionId: string;
  harnessSessionId: string;
  assistantMessageId: string;
  capabilities: HarnessCapabilities;
  buffer: string;
  flushedLength: number;
  lastFlushedAt: number;
  status: ActiveRunStatus;
  startedAt: number;
  terminal: boolean;
}

export interface ActiveRunRef {
  runId: string;
  runMode: HarnessRunMode;
  harnessSessionId: string;
  assistantMessageId: string;
  status: ActiveRunStatus;
  capabilities: HarnessCapabilities;
}

export interface HarnessUiEvent {
  runId: string;
  sessionId: string;
  messageId?: string;
  harnessSessionId?: string;
  type:
    | 'run.started'
    | 'assistant.delta'
    | 'assistant.message'
    | 'tool.started'
    | 'tool.completed'
    | 'tool.output'
    | 'approval.required'
    | 'run.completed'
    | 'run.failed'
    | 'run.cancelled'
    | 'run.interrupted';
  payload?: unknown;
}

export interface HarnessServiceOptions {
  sessions: SessionRepository;
  workspaces: WorkspaceRepository;
  messages: MessageRepository;
}

export class HarnessService {
  private readonly runtimeManager = new DshRuntimeManager();
  private readonly harness = new DshLocalHarness({ runtimeManager: this.runtimeManager });
  private readonly harnessInstanceId = `process_${Date.now()}_${randomUUID()}`;
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly activeRunBySessionId = new Map<string, ActiveRunRef>();
  private readonly harnessRunModeBySessionId = new Map<string, HarnessRunMode>();
  private logSink?: HarnessLogSink;
  private eventSink?: HarnessEventSink;

  constructor(private readonly options: HarnessServiceOptions) {
    this.options.messages.markStreamingInterrupted();
  }

  setLogSink(logSink: HarnessLogSink | undefined): void {
    this.logSink = logSink;
  }

  setEventSink(eventSink: HarnessEventSink | undefined): void {
    this.eventSink = eventSink;
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

  getActiveRuns(): Record<string, ActiveRunRef> {
    const result: Record<string, ActiveRunRef> = {};
    for (const [sessionId, run] of this.activeRunBySessionId.entries()) {
      result[sessionId] = { ...run };
    }
    return result;
  }

  async runPrompt(input: HarnessRunInput): Promise<HarnessRunStartResult> {
    this.log('main', 'runPrompt requested', {
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      promptLength: input.prompt.length,
    });

    const normalizedPrompt = input.prompt.trim();
    if (!normalizedPrompt) {
      this.log('main', 'runPrompt rejected: empty prompt');
      throw new Error('Prompt is required.');
    }

    if (this.activeRunBySessionId.has(input.sessionId)) {
      throw new Error('This session already has a running prompt.');
    }

    const session = this.options.sessions.get(input.accountId, input.sessionId);
    if (session.workspaceId !== input.workspaceId) {
      throw new Error('Session does not belong to the selected workspace.');
    }

    const workspace = this.options.workspaces.get(input.accountId, input.workspaceId);
    const userMessage = this.options.messages.create({
      sessionId: input.sessionId,
      role: 'user',
      content: normalizedPrompt,
      status: 'completed',
    });

    return this.startAssistantRun({
      accountId: input.accountId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      session,
      workspacePath: workspace.rootPath,
      prompt: normalizedPrompt,
      runMode: normalizeRunMode(input.runMode, this.runtimeManager.resolveRuntime().config.protocol),
      promptMessageId: userMessage.id,
    });
  }

  async retryMessage(messageId: string): Promise<HarnessRunStartResult> {
    this.log('main', 'retryMessage requested', { messageId });

    const sourceMessage = this.options.messages.get(messageId);
    if (sourceMessage.role !== 'assistant') {
      throw new Error('Only assistant messages can be retried.');
    }
    if (!['failed', 'cancelled', 'interrupted'].includes(sourceMessage.status)) {
      throw new Error('Only failed, cancelled, or interrupted assistant messages can be retried.');
    }
    if (this.activeRunBySessionId.has(sourceMessage.sessionId)) {
      throw new Error('This session already has a running prompt.');
    }

    const session = this.options.sessions.getById(sourceMessage.sessionId);
    if (!session.workspaceId) {
      throw new Error('Cannot retry a message without a workspace.');
    }

    const messages = this.options.messages.list(sourceMessage.sessionId);
    const sourceIndex = messages.findIndex((message) => message.id === sourceMessage.id);
    const promptMessage = sourceIndex > 0
      ? [...messages.slice(0, sourceIndex)].reverse().find((message) => message.role === 'user')
      : undefined;
    const prompt = promptMessage?.content.trim();
    if (!prompt || !promptMessage) {
      throw new Error('Cannot retry: no previous user message was found.');
    }

    const workspace = this.options.workspaces.get(session.accountId, session.workspaceId);
    return this.startAssistantRun({
      accountId: session.accountId,
      workspaceId: workspace.id,
      sessionId: session.id,
      session,
      workspacePath: workspace.rootPath,
      prompt,
      runMode: this.runtimeManager.resolveRuntime().config.protocol,
      promptMessageId: promptMessage.id,
      retrySourceMessageId: sourceMessage.id,
    });
  }

  private async startAssistantRun(input: {
    accountId: string;
    workspaceId: string;
    sessionId: string;
    session: { harnessSessionId: string | null; harnessInstanceId: string | null };
    workspacePath: string;
    prompt: string;
    runMode: HarnessRunMode;
    promptMessageId: string;
    retrySourceMessageId?: string;
  }): Promise<HarnessRunStartResult> {
    const runMode = normalizeRunMode(input.runMode, this.runtimeManager.resolveRuntime().config.protocol);
    const capabilities = this.harness.capabilities(runMode);
    const harnessSessionId = await this.resolveHarnessSession(input.accountId, input.sessionId, input.session, input.workspacePath, runMode);
    const assistantMessage = this.options.messages.create({
      sessionId: input.sessionId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      retrySourceMessageId: input.retrySourceMessageId,
      retryPromptMessageId: input.retrySourceMessageId ? input.promptMessageId : null,
    });
    const runId = randomUUID();
    const now = Date.now();
    const activeRun: ActiveRun = {
      runId,
      runMode,
      accountId: input.accountId,
      robbotSessionId: input.sessionId,
      harnessSessionId,
      assistantMessageId: assistantMessage.id,
      capabilities,
      buffer: '',
      flushedLength: 0,
      lastFlushedAt: now,
      status: 'running',
      startedAt: now,
      terminal: false,
    };

    this.activeRuns.set(runId, activeRun);
    this.activeRunBySessionId.set(input.sessionId, {
      runId,
      runMode,
      harnessSessionId,
      assistantMessageId: assistantMessage.id,
      status: activeRun.status,
      capabilities,
    });

    this.emitEvent({
      runId,
      sessionId: input.sessionId,
      messageId: assistantMessage.id,
      harnessSessionId,
      type: 'run.started',
      payload: {
        userMessageId: input.promptMessageId,
        retrySourceMessageId: input.retrySourceMessageId,
        runMode,
        capabilities,
      },
    });

    void this.executeRun(activeRun, input.prompt);

    return {
      runId,
      userMessageId: input.promptMessageId,
      assistantMessageId: assistantMessage.id,
      harnessSessionId,
      runMode,
    };
  }

  async cancel(sessionId: string): Promise<void> {
    const ref = this.activeRunBySessionId.get(sessionId);
    if (!ref) {
      return;
    }

    const run = this.activeRuns.get(ref.runId);
    if (!run) {
      return;
    }

    if (!run.capabilities.cancelCurrentRun) {
      throw new Error('Current run mode does not support per-session Stop. Use Terminate Runtime for SDK runs.');
    }

    run.status = 'cancelling';
    this.activeRunBySessionId.set(sessionId, { ...ref, status: 'cancelling' });
    try {
      await this.harness.interrupt(ref.harnessSessionId);
    } finally {
      this.finishRun(run, 'run.cancelled');
    }
  }

  async approve(sessionId: string, input: ApprovalInput): Promise<void> {
    const ref = this.activeRunBySessionId.get(sessionId);
    if (!ref) {
      throw new Error(`No active run for session: ${sessionId}`);
    }

    const run = this.activeRuns.get(ref.runId);
    await this.harness.approve(ref.harnessSessionId, input);
    if (run && run.status === 'waiting_approval') {
      run.status = 'running';
      this.activeRunBySessionId.set(sessionId, { ...ref, status: 'running' });
    }
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

  private async resolveHarnessSession(
    accountId: string,
    sessionId: string,
    session: { harnessSessionId: string | null; harnessInstanceId: string | null },
    workspacePath: string,
    runMode: HarnessRunMode,
  ): Promise<string> {
    if (
      session.harnessSessionId
      && session.harnessInstanceId === this.harnessInstanceId
      && this.harnessRunModeBySessionId.get(sessionId) === runMode
    ) {
      return session.harnessSessionId;
    }

    this.log('harness', 'creating DSH session', { sessionId, workspacePath, runMode });
    const harnessSession = await this.harness.createSession({
      workspacePath,
      metadata: { robbotSessionId: sessionId, runMode },
    });
    this.options.sessions.attachHarnessSession(accountId, sessionId, {
      harnessSessionId: harnessSession.id,
      harnessInstanceId: this.harnessInstanceId,
    });
    this.harnessRunModeBySessionId.set(sessionId, runMode);
    this.log('harness', 'DSH session created', {
      sessionId,
      harnessSessionId: harnessSession.id,
      harnessInstanceId: this.harnessInstanceId,
      runMode,
    });
    return harnessSession.id;
  }

  private async executeRun(run: ActiveRun, prompt: string): Promise<void> {
    try {
      this.log('harness', 'sending prompt to DSH', {
        sessionId: run.robbotSessionId,
        harnessSessionId: run.harnessSessionId,
        runMode: run.runMode,
      });

      for await (const event of this.harness.run(run.harnessSessionId, { prompt, metadata: { runMode: run.runMode } })) {
        this.handleHarnessEvent(run, event);
      }
    } catch (error) {
      this.finishRun(run, 'run.failed', {
        message: error instanceof Error ? error.message : String(error),
        code: 'run_error',
      });
    }
  }

  private handleHarnessEvent(run: ActiveRun, event: HarnessEvent): void {
    this.log('dsh', `event: ${event.type}`, summarizeHarnessEvent(event));

    if (event.type === 'assistant.delta') {
      run.buffer += event.text;
      this.emitEvent({
        runId: run.runId,
        sessionId: run.robbotSessionId,
        messageId: run.assistantMessageId,
        harnessSessionId: run.harnessSessionId,
        type: 'assistant.delta',
        payload: { text: event.text },
      });
      this.flushRunIfNeeded(run);
      return;
    }

    if (event.type === 'assistant.message') {
      run.buffer = event.text;
      this.flushRun(run);
      this.emitEvent({
        runId: run.runId,
        sessionId: run.robbotSessionId,
        messageId: run.assistantMessageId,
        harnessSessionId: run.harnessSessionId,
        type: 'assistant.message',
        payload: { text: event.text },
      });
      return;
    }

    if (event.type === 'tool.started' || event.type === 'tool.completed' || event.type === 'tool.output') {
      this.emitEvent({
        runId: run.runId,
        sessionId: run.robbotSessionId,
        messageId: run.assistantMessageId,
        harnessSessionId: run.harnessSessionId,
        type: event.type,
        payload: event,
      });
      return;
    }

    if (event.type === 'approval.required') {
      run.status = 'waiting_approval';
      this.activeRunBySessionId.set(run.robbotSessionId, {
        runId: run.runId,
        runMode: run.runMode,
        harnessSessionId: run.harnessSessionId,
        assistantMessageId: run.assistantMessageId,
        status: run.status,
        capabilities: run.capabilities,
      });
      this.emitEvent({
        runId: run.runId,
        sessionId: run.robbotSessionId,
        messageId: run.assistantMessageId,
        harnessSessionId: run.harnessSessionId,
        type: 'approval.required',
        payload: event.approval,
      });
      return;
    }

    if (event.type === 'run.completed') {
      this.finishRun(run, run.status === 'cancelling' ? 'run.cancelled' : 'run.completed');
      return;
    }

    if (event.type === 'run.failed') {
      this.finishRun(run, run.status === 'cancelling' ? 'run.cancelled' : 'run.failed', event.error);
      return;
    }

    if (event.type === 'run.interrupted') {
      this.finishRun(run, 'run.interrupted', event.error);
    }
  }

  private flushRunIfNeeded(run: ActiveRun): void {
    const now = Date.now();
    const shouldFlush = now - run.lastFlushedAt >= 500 || run.buffer.length - run.flushedLength >= 1024;
    if (!shouldFlush) {
      return;
    }

    this.flushRun(run);
  }

  private flushRun(run: ActiveRun): void {
    if (run.flushedLength === run.buffer.length) {
      return;
    }

    this.options.messages.updateContent(run.assistantMessageId, run.buffer);
    run.flushedLength = run.buffer.length;
    run.lastFlushedAt = Date.now();
  }

  private finishRun(run: ActiveRun, type: 'run.completed' | 'run.failed' | 'run.cancelled' | 'run.interrupted', payload?: unknown): void {
    if (run.terminal) {
      return;
    }

    run.terminal = true;
    this.flushRun(run);
    const status = type === 'run.completed'
      ? 'completed'
      : type === 'run.cancelled'
        ? 'cancelled'
        : type === 'run.interrupted'
          ? 'interrupted'
          : 'failed';
    const message =
      type === 'run.cancelled'
        ? this.options.messages.updateStreamingStatus(run.assistantMessageId, status, run.buffer)
        : this.options.messages.updateStatus(run.assistantMessageId, status, run.buffer);

    this.options.sessions.touchAfterMessage(run.accountId, run.robbotSessionId, {
      lastMessageId: run.assistantMessageId,
      lastMessageAt: message.updatedAt,
    });

    this.emitEvent({
      runId: run.runId,
      sessionId: run.robbotSessionId,
      messageId: run.assistantMessageId,
      harnessSessionId: run.harnessSessionId,
      type,
      payload,
    });

    this.activeRuns.delete(run.runId);
    this.activeRunBySessionId.delete(run.robbotSessionId);
  }

  private emitEvent(event: HarnessUiEvent): void {
    this.eventSink?.(event);
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

  if (event.type === 'run.interrupted') {
    return {
      message: event.error?.message,
      code: event.error?.code,
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

function normalizeRunMode(value: unknown, fallback: HarnessRunMode): HarnessRunMode {
  return value === 'acp' || value === 'sdk' ? value : fallback;
}
