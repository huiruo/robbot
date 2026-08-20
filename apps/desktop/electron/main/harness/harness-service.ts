import { DshLocalHarness, DshRuntimeManager, type DshRuntimeStatus } from '@robbot/dsh-adapter';
import type { ApprovalInput, HarnessCapabilities, HarnessEvent, HarnessRunMode } from '@robbot/core';
import { createHash, randomUUID } from 'node:crypto';

import type { AccountRecord, AccountRepository, MessageRecord, MessageRepository, SessionRepository, WorkspaceRepository } from '../../storage/repositories';

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

export interface HarnessWarmupInput {
  accountId: string;
  workspaceId: string;
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
  accountRuntimeEpoch: number;
  robbotSessionId: string;
  harnessSessionId: string;
  assistantMessageId: string;
  aiRuntime: AiRuntimeSnapshot | null;
  historyBootstrap?: HistoryBootstrap;
  capabilities: HarnessCapabilities;
  buffer: string;
  flushedLength: number;
  lastFlushedAt: number;
  lastActivityAt: number;
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
  accounts: AccountRepository;
  sessions: SessionRepository;
  workspaces: WorkspaceRepository;
  messages: MessageRepository;
  runInactivityTimeoutMs?: number;
}

export interface AiRuntimeSnapshot {
  provider: 'deepseek' | 'openai';
  key: string;
  model: string;
  apiUrl?: string;
  fingerprint: string;
}

interface HistoryBootstrapMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface HistoryBootstrap {
  messages: HistoryBootstrapMessage[];
}

interface HarnessReuseIdentity {
  accountId: string;
  harnessInstanceId: string;
  runMode: HarnessRunMode;
  aiConfigFingerprint: string | null;
}

interface HarnessSessionResolution {
  harnessSessionId: string;
  created: boolean;
}

const HISTORY_BOOTSTRAP_MESSAGE_LIMIT = 20;
const DEFAULT_RUN_INACTIVITY_TIMEOUT_MS = 120_000;
const RUN_WATCHDOG_INTERVAL_MS = 5_000;

export class HarnessService {
  private readonly runtimeManager = new DshRuntimeManager();
  private readonly harness = new DshLocalHarness({ runtimeManager: this.runtimeManager });
  private readonly harnessInstanceId = `process_${Date.now()}_${randomUUID()}`;
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly activeRunBySessionId = new Map<string, ActiveRunRef>();
  private readonly retryingMessageIds = new Set<string>();
  private readonly runInactivityTimeoutMs: number;
  private readonly runWatchdog: ReturnType<typeof setInterval>;
  private readonly harnessRunModeBySessionId = new Map<string, HarnessRunMode>();
  private readonly harnessReuseIdentityBySessionId = new Map<string, HarnessReuseIdentity>();
  private readonly accountRuntimeEpoch = new Map<string, number>();
  private logSink?: HarnessLogSink;
  private eventSink?: HarnessEventSink;

  constructor(private readonly options: HarnessServiceOptions) {
    this.runInactivityTimeoutMs = options.runInactivityTimeoutMs ?? DEFAULT_RUN_INACTIVITY_TIMEOUT_MS;
    this.options.messages.markStreamingInterrupted();
    this.runWatchdog = setInterval(() => this.checkRunWatchdog(), RUN_WATCHDOG_INTERVAL_MS);
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

  async warmup(input: HarnessWarmupInput): Promise<void> {
    const runMode = normalizeRunMode(input.runMode, this.runtimeManager.resolveRuntime().config.protocol);
    const workspace = this.options.workspaces.get(input.accountId, input.workspaceId);
    const aiRuntime = resolveAiRuntimeSnapshot(this.options.accounts.get(input.accountId));
    this.log('harness', 'warming up DSH runtime', {
      workspaceId: input.workspaceId,
      workspacePath: workspace.rootPath,
      runMode,
      aiProvider: aiRuntime?.provider,
      aiModel: aiRuntime?.model,
      aiConfigFingerprint: aiRuntime?.fingerprint,
    });

    await this.harness.warmup({
      workspacePath: workspace.rootPath,
      metadata: {
        accountId: input.accountId,
        runMode,
        aiRuntime,
      },
    });
    this.log('harness', 'DSH runtime warmup complete', {
      workspaceId: input.workspaceId,
      runMode,
      aiProvider: aiRuntime?.provider,
      aiModel: aiRuntime?.model,
      aiConfigFingerprint: aiRuntime?.fingerprint,
    });
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
      promptMessageCreatedAt: userMessage.createdAt,
    });
  }

  async retryMessage(messageId: string): Promise<HarnessRunStartResult> {
    this.log('main', 'retryMessage requested', { messageId });
    if (this.retryingMessageIds.has(messageId)) {
      throw new Error('This message is already being retried.');
    }
    this.retryingMessageIds.add(messageId);

    try {
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
        promptMessageCreatedAt: promptMessage.createdAt,
        retrySourceMessageId: sourceMessage.id,
      });
    } finally {
      this.retryingMessageIds.delete(messageId);
    }
  }

  private async startAssistantRun(input: {
    accountId: string;
    workspaceId: string;
    sessionId: string;
    session: { harnessSessionId: string | null; harnessInstanceId: string | null; harnessAiConfigFingerprint: string | null };
    workspacePath: string;
    prompt: string;
    runMode: HarnessRunMode;
    promptMessageId: string;
    promptMessageCreatedAt: number;
    retrySourceMessageId?: string;
  }): Promise<HarnessRunStartResult> {
    const runMode = normalizeRunMode(input.runMode, this.runtimeManager.resolveRuntime().config.protocol);
    const aiRuntime = resolveAiRuntimeSnapshot(this.options.accounts.get(input.accountId));
    const accountRuntimeEpoch = this.currentAccountEpoch(input.accountId);
    const capabilities = this.harness.capabilities(runMode);
    const harnessSession = await this.resolveHarnessSession(input.accountId, input.sessionId, input.session, input.workspacePath, runMode, aiRuntime);
    const historyBootstrap = harnessSession.created && runMode === 'sdk'
      ? this.buildHistoryBootstrap(input.sessionId, input.promptMessageId, input.promptMessageCreatedAt, input.retrySourceMessageId)
      : undefined;
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
      accountRuntimeEpoch,
      robbotSessionId: input.sessionId,
      harnessSessionId: harnessSession.harnessSessionId,
      assistantMessageId: assistantMessage.id,
      aiRuntime,
      historyBootstrap,
      capabilities,
      buffer: '',
      flushedLength: 0,
      lastFlushedAt: now,
      lastActivityAt: now,
      status: 'running',
      startedAt: now,
      terminal: false,
    };

    this.activeRuns.set(runId, activeRun);
    this.activeRunBySessionId.set(input.sessionId, {
      runId,
      runMode,
      harnessSessionId: harnessSession.harnessSessionId,
      assistantMessageId: assistantMessage.id,
      status: activeRun.status,
      capabilities,
    });

    this.emitEvent({
      runId,
      sessionId: input.sessionId,
      messageId: assistantMessage.id,
      harnessSessionId: harnessSession.harnessSessionId,
      type: 'run.started',
      payload: {
        userMessageId: input.promptMessageId,
        retrySourceMessageId: input.retrySourceMessageId,
        runMode,
        capabilities,
        aiProvider: aiRuntime?.provider,
        aiModel: aiRuntime?.model,
        aiConfigFingerprint: aiRuntime?.fingerprint,
        historyBootstrapMessageCount: historyBootstrap?.messages.length ?? 0,
      },
    });

    void this.executeRun(activeRun, input.prompt);

    return {
      runId,
      userMessageId: input.promptMessageId,
      assistantMessageId: assistantMessage.id,
      harnessSessionId: harnessSession.harnessSessionId,
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

    if (!run.capabilities.cancelCurrentRun && !run.capabilities.terminateRuntime) {
      throw new Error('Current run mode does not support Stop.');
    }

    run.status = 'cancelling';
    this.activeRunBySessionId.set(sessionId, { ...ref, status: 'cancelling' });
    if (!run.capabilities.cancelCurrentRun && run.capabilities.terminateRuntime) {
      this.finishRun(run, 'run.interrupted', {
        code: 'runtime_terminated',
        message: 'Run was stopped by terminating the DSH runtime.',
      });
      await this.terminateRunRuntime(run);
      return;
    }

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
      this.markRunActivity(run);
      this.activeRunBySessionId.set(sessionId, { ...ref, status: 'running' });
    }
  }

  async dispose(): Promise<void> {
    this.log('main', 'disposing HarnessService');
    clearInterval(this.runWatchdog);
    await this.harness.dispose();
  }

  async resetForAccount(accountId: string): Promise<void> {
    this.log('main', 'resetting harness for account', { accountId });
    const accountRuns = [...this.activeRuns.values()].filter((run) => run.accountId === accountId);
    for (const run of accountRuns) {
      this.finishRun(run, 'run.interrupted', {
        code: 'account_logout',
        message: 'Account signed out; runtime was reset.',
      });
    }

    this.accountRuntimeEpoch.set(accountId, this.currentAccountEpoch(accountId) + 1);
    for (const [sessionId, ref] of [...this.activeRunBySessionId.entries()]) {
      const run = this.activeRuns.get(ref.runId);
      if (!run || run.accountId === accountId) {
        this.activeRunBySessionId.delete(sessionId);
      }
    }
    for (const [sessionId, identity] of [...this.harnessReuseIdentityBySessionId.entries()]) {
      if (identity.accountId === accountId) {
        this.harnessReuseIdentityBySessionId.delete(sessionId);
        this.harnessRunModeBySessionId.delete(sessionId);
      }
    }

    await this.runtimeManager.stopAll();
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
    session: { harnessSessionId: string | null; harnessInstanceId: string | null; harnessAiConfigFingerprint: string | null },
    workspacePath: string,
    runMode: HarnessRunMode,
    aiRuntime: AiRuntimeSnapshot | null,
  ): Promise<HarnessSessionResolution> {
    const reuseIdentity: HarnessReuseIdentity = {
      accountId,
      harnessInstanceId: this.harnessInstanceId,
      runMode,
      aiConfigFingerprint: aiRuntime?.fingerprint ?? null,
    };
    const previousIdentity = this.harnessReuseIdentityBySessionId.get(sessionId);
    const persistedIdentityMatches = Boolean(
      session.harnessSessionId
      && session.harnessInstanceId === this.harnessInstanceId
      && session.harnessAiConfigFingerprint === reuseIdentity.aiConfigFingerprint
      && this.harnessRunModeBySessionId.get(sessionId) === runMode
      && (!previousIdentity || reuseIdentityEquals(previousIdentity, reuseIdentity)),
    );
    if (persistedIdentityMatches) {
      return { harnessSessionId: session.harnessSessionId!, created: false };
    }

    this.log('harness', 'creating DSH session', {
      sessionId,
      workspacePath,
      runMode,
      aiProvider: aiRuntime?.provider,
      aiModel: aiRuntime?.model,
      aiConfigFingerprint: aiRuntime?.fingerprint,
    });
    const harnessSession = await this.harness.createSession({
      workspacePath,
      metadata: {
        robbotSessionId: sessionId,
        accountId,
        runMode,
        aiRuntime,
      },
    });
    this.options.sessions.attachHarnessSession(accountId, sessionId, {
      harnessSessionId: harnessSession.id,
      harnessInstanceId: this.harnessInstanceId,
      harnessAiProvider: aiRuntime?.provider ?? null,
      harnessAiModel: aiRuntime?.model ?? null,
      harnessAiBaseUrl: aiRuntime?.apiUrl ?? null,
      harnessAiConfigFingerprint: aiRuntime?.fingerprint ?? null,
    });
    this.harnessRunModeBySessionId.set(sessionId, runMode);
    this.harnessReuseIdentityBySessionId.set(sessionId, reuseIdentity);
    this.log('harness', 'DSH session created', {
      sessionId,
      harnessSessionId: harnessSession.id,
      harnessInstanceId: this.harnessInstanceId,
      runMode,
      aiProvider: aiRuntime?.provider,
      aiModel: aiRuntime?.model,
      aiConfigFingerprint: aiRuntime?.fingerprint,
    });
    return { harnessSessionId: harnessSession.id, created: true };
  }

  private async executeRun(run: ActiveRun, prompt: string): Promise<void> {
    try {
      this.log('harness', 'sending prompt to DSH', {
        sessionId: run.robbotSessionId,
        harnessSessionId: run.harnessSessionId,
        runMode: run.runMode,
        aiProvider: run.aiRuntime?.provider,
        aiModel: run.aiRuntime?.model,
        aiConfigFingerprint: run.aiRuntime?.fingerprint,
        historyBootstrapMessageCount: run.historyBootstrap?.messages.length ?? 0,
      });

      for await (const event of this.harness.run(run.harnessSessionId, {
        prompt,
        metadata: {
          runMode: run.runMode,
          ...(run.historyBootstrap ? { historyBootstrap: run.historyBootstrap } : {}),
        },
      })) {
        this.handleHarnessEvent(run, event);
      }
    } catch (error) {
      if (!this.isRunCurrent(run)) {
        return;
      }
      this.finishRun(run, 'run.failed', {
        message: error instanceof Error ? error.message : String(error),
        code: 'run_error',
      });
    }
  }

  private buildHistoryBootstrap(
    sessionId: string,
    promptMessageId: string,
    promptMessageCreatedAt: number,
    retrySourceMessageId?: string,
  ): HistoryBootstrap | undefined {
    const messages = this.options.messages
      .list(sessionId)
      .filter((message) => isBootstrapMessage(message, promptMessageId, promptMessageCreatedAt, retrySourceMessageId))
      .slice(-HISTORY_BOOTSTRAP_MESSAGE_LIMIT)
      .map((message) => ({
        role: message.role,
        content: message.content.trim(),
      }));

    if (!messages.length) {
      return undefined;
    }

    this.log('harness', 'prepared history bootstrap for new DSH session', {
      sessionId,
      messageCount: messages.length,
    });
    return { messages };
  }

  private handleHarnessEvent(run: ActiveRun, event: HarnessEvent): void {
    if (!this.isRunCurrent(run)) {
      return;
    }

    this.markRunActivity(run);
    // this.log('dsh', `event: ${event.type}`, summarizeHarnessEvent(event));

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
      if (run.runMode === 'sdk' && isSdkFatalRunError(event.error.code)) {
        void this.terminateRunRuntime(run);
      }
      return;
    }

    if (event.type === 'run.interrupted') {
      this.finishRun(run, 'run.interrupted', event.error);
      if (run.runMode === 'sdk') {
        void this.invalidateHarnessSession(run);
      }
    }
  }

  private checkRunWatchdog(): void {
    const now = Date.now();
    for (const run of this.activeRuns.values()) {
      if (run.runMode !== 'sdk' || run.status !== 'running' || run.terminal) {
        continue;
      }

      const inactiveFor = now - run.lastActivityAt;
      if (inactiveFor < this.runInactivityTimeoutMs) {
        continue;
      }

      this.log('harness', 'SDK run inactivity timeout', {
        sessionId: run.robbotSessionId,
        harnessSessionId: run.harnessSessionId,
        runId: run.runId,
        inactiveFor,
        timeoutMs: this.runInactivityTimeoutMs,
      });
      this.finishRun(run, 'run.failed', {
        code: 'run_timeout',
        message: `Run produced no activity for ${this.runInactivityTimeoutMs}ms.`,
      });
      void this.terminateRunRuntime(run);
    }
  }

  private markRunActivity(run: ActiveRun): void {
    run.lastActivityAt = Date.now();
  }

  private flushRunIfNeeded(run: ActiveRun): void {
    if (!this.isRunCurrent(run)) {
      return;
    }

    const now = Date.now();
    const shouldFlush = now - run.lastFlushedAt >= 500 || run.buffer.length - run.flushedLength >= 1024;
    if (!shouldFlush) {
      return;
    }

    this.flushRun(run);
  }

  private flushRun(run: ActiveRun): void {
    if (!this.isRunCurrent(run)) {
      return;
    }

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
    if (!this.isRunCurrent(run)) {
      return;
    }

    this.flushRun(run);
    run.terminal = true;
    const status = type === 'run.completed'
      ? 'completed'
      : type === 'run.cancelled'
        ? 'cancelled'
        : type === 'run.interrupted'
          ? 'interrupted'
          : 'failed';
    const finalContent = finalAssistantContent(run, type, payload);
    const message =
      type === 'run.cancelled'
        ? this.options.messages.updateStreamingStatus(run.assistantMessageId, status, finalContent)
        : this.options.messages.updateStatus(run.assistantMessageId, status, finalContent);

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

  private isRunCurrent(run: ActiveRun): boolean {
    return !run.terminal
      && this.activeRuns.get(run.runId) === run
      && run.accountRuntimeEpoch === this.currentAccountEpoch(run.accountId);
  }

  private async terminateRunRuntime(run: ActiveRun): Promise<void> {
    this.invalidateHarnessSession(run);
    try {
      await this.harness.terminate(run.harnessSessionId);
    } catch (error) {
      this.log('harness', 'failed to terminate DSH runtime after run end', {
        sessionId: run.robbotSessionId,
        harnessSessionId: run.harnessSessionId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private invalidateHarnessSession(run: ActiveRun): void {
    this.harnessRunModeBySessionId.delete(run.robbotSessionId);
    this.harnessReuseIdentityBySessionId.delete(run.robbotSessionId);
    this.options.sessions.detachHarnessSession(run.accountId, run.robbotSessionId);
  }

  private currentAccountEpoch(accountId: string): number {
    return this.accountRuntimeEpoch.get(accountId) ?? 0;
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

function isBootstrapMessage(
  message: MessageRecord,
  promptMessageId: string,
  promptMessageCreatedAt: number,
  retrySourceMessageId?: string,
): message is MessageRecord & { role: 'user' | 'assistant' } {
  if (message.id === promptMessageId || message.id === retrySourceMessageId) {
    return false;
  }

  if (message.createdAt >= promptMessageCreatedAt) {
    return false;
  }

  if (message.status !== 'completed') {
    return false;
  }

  if (message.role !== 'user' && message.role !== 'assistant') {
    return false;
  }

  return message.content.trim().length > 0;
}

function finalAssistantContent(
  run: ActiveRun,
  type: 'run.completed' | 'run.failed' | 'run.cancelled' | 'run.interrupted',
  payload: unknown,
): string {
  if (type === 'run.completed' || type === 'run.cancelled') {
    return run.buffer;
  }

  const existing = run.buffer.trim();
  if (existing) {
    return run.buffer;
  }

  if (type === 'run.interrupted') {
    return '任务已中断。';
  }

  return formatRunFailureMessage(run, payload);
}

function formatRunFailureMessage(run: ActiveRun, payload: unknown): string {
  const error = asErrorPayload(payload);
  const provider = run.aiRuntime?.provider === 'openai'
    ? 'OpenAI-compatible'
    : run.aiRuntime?.provider === 'deepseek'
      ? 'DeepSeek'
      : 'AI provider';
  const model = run.aiRuntime?.model ? `\n模型：${run.aiRuntime.model}` : '';
  const rawMessage = error.message || 'Unknown error.';
  const code = error.code || 'UNKNOWN';

  if (code === 'run_timeout' || code === 'sdk_prompt_timeout' || code === 'sdk_request_timeout' || code === 'sdk_run_timeout') {
    return [
      `${provider} 请求超时或 DSH runtime 无响应。`,
      '当前 runtime 已被终止；下一次发送会创建新的 Harness Session，并从本地历史恢复上下文。',
      model,
      `错误码：${code}`,
      `原始错误：${rawMessage}`,
    ].filter(Boolean).join('\n');
  }

  if (code === 'TRANSPORT' || /connection error/i.test(rawMessage)) {
    return [
      `${provider} 请求失败：连接错误。`,
      '请检查 API key、apiUrl/baseURL 是否正确，以及当前网络是否能访问该模型服务。',
      model,
      `错误码：${code}`,
      `原始错误：${rawMessage}`,
    ].filter(Boolean).join('\n');
  }

  if (code === 'RATE_LIMIT' || /rate limit|429/i.test(rawMessage)) {
    return [
      `${provider} 请求失败：触发限流或额度限制。`,
      '请稍后重试，或检查当前 key 的额度/速率限制。',
      model,
      `错误码：${code}`,
      `原始错误：${rawMessage}`,
    ].filter(Boolean).join('\n');
  }

  if (/unauthorized|invalid api key|401|403/i.test(rawMessage) || code === 'UNAUTHORIZED' || code === 'AUTHENTICATION') {
    return [
      `${provider} 请求失败：认证失败。`,
      '请检查 Settings 里的 API key 是否正确，并确认该 key 有权限访问当前模型。',
      model,
      `错误码：${code}`,
      `原始错误：${rawMessage}`,
    ].filter(Boolean).join('\n');
  }

  return [
    `${provider} 请求失败。`,
    '请检查 Settings 里的 provider、model、key 和 apiUrl/baseURL 配置。',
    model,
    `错误码：${code}`,
    `原始错误：${rawMessage}`,
  ].filter(Boolean).join('\n');
}

function asErrorPayload(value: unknown): { message: string; code?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { message: value === undefined ? 'Unknown error.' : String(value) };
  }

  const record = value as Record<string, unknown>;
  return {
    message: typeof record.message === 'string' ? record.message : String(record.message ?? 'Unknown error.'),
    code: typeof record.code === 'string' ? record.code : undefined,
  };
}

function isSdkFatalRunError(code: string | undefined): boolean {
  return code === 'sdk_prompt_timeout'
    || code === 'sdk_request_timeout'
    || code === 'sdk_run_timeout'
    || code === 'runtime_terminated';
}

function reuseIdentityEquals(left: HarnessReuseIdentity, right: HarnessReuseIdentity): boolean {
  return left.accountId === right.accountId
    && left.harnessInstanceId === right.harnessInstanceId
    && left.runMode === right.runMode
    && left.aiConfigFingerprint === right.aiConfigFingerprint;
}

function resolveAiRuntimeSnapshot(account: AccountRecord): AiRuntimeSnapshot | null {
  if (account.selectedAi !== 'deepseek' && account.selectedAi !== 'openai') {
    return null;
  }

  const rawConfig = account.selectedAi === 'deepseek' ? account.deepseek : account.openai;
  const config = parseSelectedAiConfig(account.selectedAi, rawConfig);
  const snapshot: Omit<AiRuntimeSnapshot, 'fingerprint'> = {
    provider: account.selectedAi,
    key: config.key,
    model: config.model,
    apiUrl: config.apiUrl,
  };
  return {
    ...snapshot,
    fingerprint: fingerprintAiRuntime(snapshot),
  };
}

function parseSelectedAiConfig(provider: 'deepseek' | 'openai', rawConfig: string | null): {
  key: string;
  model: string;
  apiUrl?: string;
} {
  if (!rawConfig) {
    throw new Error(`${provider} is selected, but its AI config is empty.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    throw new Error(`${provider} AI config is not valid JSON.`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${provider} AI config must be a JSON object.`);
  }

  const record = parsed as Record<string, unknown>;
  const key = stringField(record, 'key');
  const model = stringField(record, 'model');
  const apiUrl = stringField(record, 'apiUrl');
  if (!key) {
    throw new Error(`${provider} AI config requires a non-empty key.`);
  }
  if (!model) {
    throw new Error(`${provider} AI config requires a non-empty model.`);
  }

  return { key, model, apiUrl };
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function fingerprintAiRuntime(input: {
  provider: 'deepseek' | 'openai';
  key: string;
  model: string;
  apiUrl?: string;
}): string {
  const keyHash = createHash('sha256').update(input.key).digest('hex');
  return createHash('sha256')
    .update(JSON.stringify({
      provider: input.provider,
      model: input.model,
      apiUrl: input.apiUrl ?? '',
      keyHash,
    }))
    .digest('hex');
}
