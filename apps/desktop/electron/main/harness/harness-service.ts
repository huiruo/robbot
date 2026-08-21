import { DshLocalHarness, DshRuntimeManager, type DshRuntimeStatus } from '@robbot/dsh-adapter';
import type { ApprovalInput, HarnessCapabilities, HarnessEvent, HarnessRunMode } from '@robbot/core';
import { randomUUID } from 'node:crypto';
import type { AccountRecord, AccountRepository, MessageRepository, SessionEventRepository, SessionRepository, WorkspaceRepository } from '../../storage/repositories';
import type { AccountDshEnvironmentService, AccountDshEnvironment } from './account-dsh-environment-service';

export interface HarnessRuntimeStatus { status: DshRuntimeStatus; runtimeRoot: string }
export interface HarnessRunInput { accountId: string; workspaceId: string; sessionId: string; prompt: string; runMode?: HarnessRunMode }
export interface HarnessWarmupInput { accountId: string; workspaceId: string; runMode?: HarnessRunMode }
export interface HarnessRunStartResult { runId: string; userMessageId: string; assistantMessageId: string; harnessSessionId: string; runMode: HarnessRunMode }
export interface HarnessLogEntry { at: string; source: 'renderer' | 'main' | 'harness' | 'dsh'; message: string; data?: Record<string, unknown> }
export type HarnessLogSink = (entry: HarnessLogEntry) => void;
export type HarnessEventSink = (event: HarnessUiEvent) => void;
export type ActiveRunStatus = 'running' | 'waiting_approval' | 'cancelling';
export interface ActiveRunRef { runId: string; runMode: HarnessRunMode; harnessSessionId: string; assistantMessageId: string; status: ActiveRunStatus; capabilities: HarnessCapabilities }
export interface HarnessUiEvent { runId: string; sessionId: string; messageId?: string; harnessSessionId?: string; type: 'run.started' | 'assistant.delta' | 'assistant.reasoning.delta' | 'assistant.message' | 'tool.started' | 'tool.completed' | 'tool.output' | 'approval.required' | 'run.completed' | 'run.failed' | 'run.cancelled' | 'run.interrupted'; payload?: unknown }
export interface HarnessServiceOptions { accounts: AccountRepository; sessions: SessionRepository; workspaces: WorkspaceRepository; messages: MessageRepository; sessionEvents: SessionEventRepository }

interface RunRecord { ref: ActiveRunRef; accountId: string; generation: number; buffer: string }

/** Thin Robbot product projection over the official DSH runtime. */
export class HarnessService {
  private readonly runtimeManager = new DshRuntimeManager();
  private readonly harness = new DshLocalHarness({ runtimeManager: this.runtimeManager });
  private readonly processId = `robbot_${Date.now()}_${randomUUID()}`;
  private readonly dshSessions = new Map<string, string>();
  private readonly runs = new Map<string, RunRecord>();
  private readonly runBySession = new Map<string, string>();
  private generation = 0;
  private logSink?: HarnessLogSink;
  private eventSink?: HarnessEventSink;

  constructor(private readonly options: HarnessServiceOptions & { accountDshEnvironment: AccountDshEnvironmentService }) { options.messages.markStreamingInterrupted() }
  setLogSink(sink: HarnessLogSink | undefined): void { this.logSink = sink }
  setEventSink(sink: HarnessEventSink | undefined): void { this.eventSink = sink }

  getStatus(): HarnessRuntimeStatus {
    const runtime = this.runtimeManager.resolveRuntime();
    return { status: this.runtimeManager.status(), runtimeRoot: runtime.root };
  }

  getActiveRuns(): Record<string, ActiveRunRef> {
    return Object.fromEntries([...this.runBySession].flatMap(([sessionId, runId]) => {
      const run = this.runs.get(runId);
      return run ? [[sessionId, { ...run.ref }]] : [];
    }));
  }

  async warmup(input: HarnessWarmupInput): Promise<void> {
    const workspace = this.options.workspaces.get(input.accountId, input.workspaceId);
    const account = this.options.accounts.get(input.accountId);
    const environment = this.options.accountDshEnvironment.resolve(account);
    const runMode = normalizeRunMode(input.runMode, this.runtimeManager.resolveRuntime().config.protocol);
    await this.harness.warmup({ workspacePath: workspace.rootPath, metadata: this.metadata(runMode, environment) });
  }

  async getWebUrlForAccount(accountId: string): Promise<{ url: string; partition: string; accountHash: string; fingerprint: string }> {
    const account = this.options.accounts.get(accountId);
    const environment = this.options.accountDshEnvironment.resolve(account);
    const { aiRuntime } = environment;
    const runMode = normalizeRunMode('web', this.runtimeManager.resolveRuntime().config.protocol);
    this.log('main', 'starting native DSH web UI', {
      accountId,
      accountHash: environment.accountHash,
      provider: aiRuntime.provider,
      model: aiRuntime.model,
      keyFingerprint: aiRuntime.keyFingerprint,
      fingerprint: aiRuntime.fingerprint,
      dshHome: environment.dshHome,
    });
    const url = await this.harness.webUrl({ metadata: this.metadata(runMode, environment) });
    return { url, partition: environment.partition, accountHash: environment.accountHash, fingerprint: aiRuntime.fingerprint };
  }

  async runPrompt(input: HarnessRunInput): Promise<HarnessRunStartResult> {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error('Prompt is required.');
    if (this.runBySession.has(input.sessionId)) throw new Error('This session already has a running prompt.');
    const session = this.options.sessions.get(input.accountId, input.sessionId);
    if (session.workspaceId !== input.workspaceId) throw new Error('Session does not belong to the selected workspace.');
    const workspace = this.options.workspaces.get(input.accountId, input.workspaceId);
    const account = this.options.accounts.get(input.accountId);
    this.options.accountDshEnvironment.resolve(account);
    const user = this.options.messages.create({ sessionId: input.sessionId, role: 'user', content: prompt });
    return this.startRun(input.accountId, input.workspaceId, input.sessionId, workspace.rootPath, prompt, user.id, input.runMode);
  }

  async retryMessage(messageId: string): Promise<HarnessRunStartResult> {
    const source = this.options.messages.get(messageId);
    if (source.role !== 'assistant' || !['failed', 'cancelled', 'interrupted'].includes(source.status)) throw new Error('Only failed, cancelled, or interrupted assistant messages can be retried.');
    const session = this.options.sessions.getById(source.sessionId);
    if (!session.workspaceId) throw new Error('Cannot retry a message without a workspace.');
    const prompt = [...this.options.messages.list(source.sessionId)].reverse().find((m) => m.role === 'user' && m.createdAt < source.createdAt)?.content.trim();
    if (!prompt) throw new Error('Cannot retry: no previous user message was found.');
    if (this.runBySession.has(source.sessionId)) throw new Error('This session already has a running prompt.');
    const workspace = this.options.workspaces.get(session.accountId, session.workspaceId);
    const user = this.options.messages.create({ sessionId: source.sessionId, role: 'user', content: prompt });
    return this.startRun(session.accountId, workspace.id, session.id, workspace.rootPath, prompt, user.id);
  }

  async retryMessageForAccount(accountId: string, messageId: string): Promise<HarnessRunStartResult> {
    const source = this.options.messages.get(messageId);
    const session = this.options.sessions.getById(source.sessionId);
    if (session.accountId !== accountId) {
      throw new Error('Account mismatch.');
    }
    return this.retryMessage(messageId);
  }

  async cancel(sessionId: string): Promise<void> {
    const run = this.currentRun(sessionId);
    if (!run) return;
    run.ref.status = 'cancelling';
    try { await this.harness.interrupt(run.ref.harnessSessionId) } finally { this.finish(run, sessionId, 'run.cancelled') }
  }

  async approve(sessionId: string, input: ApprovalInput): Promise<void> {
    const run = this.currentRun(sessionId);
    if (!run) throw new Error(`No active run for session: ${sessionId}`);
    await this.harness.approve(run.ref.harnessSessionId, input);
    run.ref.status = 'running';
  }

  async dispose(): Promise<void> { this.generation += 1; await this.harness.dispose(); this.runs.clear(); this.runBySession.clear(); this.dshSessions.clear() }
  async resetForAccount(accountId: string): Promise<void> {
    this.generation += 1;
    for (const [sessionId, runId] of this.runBySession) if (this.runs.get(runId)?.accountId === accountId) this.runBySession.delete(sessionId);
    await this.harness.dispose();
    this.dshSessions.clear();
    this.runs.clear();
  }

  private async startRun(accountId: string, workspaceId: string, robbotSessionId: string, workspacePath: string, prompt: string, userMessageId: string, requestedMode?: HarnessRunMode): Promise<HarnessRunStartResult> {
    const account = this.options.accounts.get(accountId);
    const environment = this.options.accountDshEnvironment.resolve(account);
    const { aiRuntime } = environment;
    const runMode = normalizeRunMode(requestedMode, this.runtimeManager.resolveRuntime().config.protocol);
    this.log('main', 'starting DSH run', { accountId, accountHash: environment.accountHash, provider: aiRuntime.provider, model: aiRuntime.model, keyFingerprint: aiRuntime.keyFingerprint, fingerprint: aiRuntime.fingerprint });
    const harnessSessionId = await this.ensureDshSession(accountId, robbotSessionId, workspacePath, account, runMode, environment);
    const capabilities = this.harness.capabilities(runMode);
    const assistant = this.options.messages.create({ sessionId: robbotSessionId, role: 'assistant', content: '', status: 'streaming' });
    const ref: ActiveRunRef = { runId: randomUUID(), runMode, harnessSessionId, assistantMessageId: assistant.id, status: 'running', capabilities };
    const run: RunRecord = { ref, accountId, generation: this.generation, buffer: '' };
    this.runs.set(ref.runId, run); this.runBySession.set(robbotSessionId, ref.runId);
    this.emit({ ...ref, sessionId: robbotSessionId, messageId: assistant.id, type: 'run.started', payload: { userMessageId, workspaceId } });
    void this.consume(run, robbotSessionId, prompt, environment);
    return { runId: ref.runId, userMessageId, assistantMessageId: assistant.id, harnessSessionId, runMode };
  }

  private async ensureDshSession(accountId: string, robbotSessionId: string, workspacePath: string, account: AccountRecord, runMode: HarnessRunMode, environment: AccountDshEnvironment): Promise<string> {
    const existing = this.dshSessions.get(robbotSessionId);
    if (existing) return existing;
    const created = await this.harness.createSession({ workspacePath, metadata: { ...this.metadata(runMode, environment), robbotSessionId } });
    this.dshSessions.set(robbotSessionId, created.id);
    this.options.sessions.attachHarnessSession(accountId, robbotSessionId, {
      harnessSessionId: created.id,
      harnessInstanceId: this.processId,
      harnessAiProvider: environment.aiRuntime.provider,
      harnessAiModel: environment.aiRuntime.model ?? null,
      harnessAiBaseUrl: environment.aiRuntime.apiUrl ?? null,
      harnessAiConfigFingerprint: environment.aiRuntime.fingerprint,
    });
    return created.id;
  }

  private async consume(run: RunRecord, sessionId: string, prompt: string, environment: AccountDshEnvironment): Promise<void> {
    try { for await (const event of this.harness.run(run.ref.harnessSessionId, { prompt, metadata: this.metadata(run.ref.runMode, environment) })) this.apply(run, sessionId, event) }
    catch (error) { this.finish(run, sessionId, 'run.failed', { code: 'runtime_error', message: error instanceof Error ? error.message : String(error) }) }
  }

  private apply(run: RunRecord, sessionId: string, event: HarnessEvent): void {
    if (run.generation !== this.generation) return;
    const base = { ...run.ref, sessionId, messageId: run.ref.assistantMessageId, harnessSessionId: run.ref.harnessSessionId };
    switch (event.type) {
      case 'assistant.delta': run.buffer += event.text; this.options.messages.updateContent(run.ref.assistantMessageId, run.buffer); this.emit({ ...base, type: 'assistant.delta', payload: { text: event.text } }); break;
      case 'assistant.reasoning.delta': this.emit({ ...base, type: 'assistant.reasoning.delta', payload: { text: event.text } }); break;
      case 'assistant.message': run.buffer = event.text; this.options.messages.updateContent(run.ref.assistantMessageId, run.buffer); this.emit({ ...base, type: 'assistant.message', payload: { text: event.text } }); break;
      case 'approval.required': run.ref.status = 'waiting_approval'; this.emit({ ...base, type: 'approval.required', payload: event.approval }); break;
      case 'tool.started': this.emit({ ...base, type: 'tool.started', payload: event }); break;
      case 'tool.output': this.emit({ ...base, type: 'tool.output', payload: event }); break;
      case 'tool.completed': this.emit({ ...base, type: 'tool.completed', payload: event }); break;
      case 'run.completed': this.finish(run, sessionId, 'run.completed'); break;
      case 'run.failed': this.finish(run, sessionId, 'run.failed', event.error); break;
      case 'run.interrupted': this.finish(run, sessionId, 'run.interrupted', event.error); break;
      case 'run.started': case 'runtime.activity': break;
    }
  }

  private finish(run: RunRecord, sessionId: string, type: 'run.completed' | 'run.failed' | 'run.cancelled' | 'run.interrupted', payload?: unknown): void {
    if (run.generation !== this.generation) return;
    if (!this.runs.has(run.ref.runId)) return;
    const status = type === 'run.completed' ? 'completed' : type === 'run.cancelled' ? 'cancelled' : type === 'run.interrupted' ? 'interrupted' : 'failed';
    this.options.messages.updateStreamingStatus(run.ref.assistantMessageId, status, run.buffer || undefined);
    const message = this.options.messages.get(run.ref.assistantMessageId);
    const session = this.options.sessions.getById(sessionId);
    this.options.sessions.touchAfterMessage(session.accountId, sessionId, { lastMessageId: message.id, lastMessageAt: message.updatedAt });
    this.emit({ ...run.ref, sessionId, messageId: message.id, type, payload });
    this.runs.delete(run.ref.runId); this.runBySession.delete(sessionId);
  }

  private currentRun(sessionId: string): RunRecord | undefined { const id = this.runBySession.get(sessionId); return id ? this.runs.get(id) : undefined }
  private emit(event: HarnessUiEvent): void {
    this.options.sessionEvents.append(event.sessionId, event.type, event);
    this.eventSink?.(event);
  }
  private log(source: HarnessLogEntry['source'], message: string, data?: Record<string, unknown>): void { this.logSink?.({ at: new Date().toISOString(), source, message, data }) }

  private metadata(runMode: HarnessRunMode, environment: AccountDshEnvironment): Record<string, unknown> {
    return {
      runMode,
      accountId: environment.aiRuntime.accountId,
      accountHash: environment.accountHash,
      dshHome: environment.dshHome,
      aiRuntime: environment.aiRuntime,
    };
  }
}

function normalizeRunMode(value: unknown, fallback: HarnessRunMode): HarnessRunMode { return value === 'acp' || value === 'web' || value === 'sdk' ? value : fallback }
