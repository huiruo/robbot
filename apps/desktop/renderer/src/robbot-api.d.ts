export interface HarnessRuntimeStatus {
  status: 'missing' | 'not_installed' | 'ready' | 'running';
  runtimeRoot: string;
}

export interface HarnessRunResult {
  runId: string;
  userMessageId: string;
  assistantMessageId: string;
  harnessSessionId: string;
  runMode: HarnessRunMode;
}

export type HarnessRunMode = 'sdk' | 'acp';
export type HarnessStreamingCapability = 'none' | 'committed-message' | 'runtime-events';

export interface HarnessCapabilities {
  streaming: HarnessStreamingCapability;
  toolEvents: boolean;
  cancelCurrentRun: boolean;
  approval: boolean;
  sessionResume: boolean;
}

export type ActiveRunStatus = 'running' | 'waiting_approval' | 'cancelling';

export interface ActiveRunRef {
  runId: string;
  runMode: HarnessRunMode;
  harnessSessionId: string;
  assistantMessageId: string;
  status: ActiveRunStatus;
  capabilities: HarnessCapabilities;
}

export interface HarnessRunInput {
  accountId: string;
  workspaceId: string;
  sessionId: string;
  prompt: string;
  runMode?: HarnessRunMode;
}

export type HarnessEventType =
  | 'run.started'
  | 'assistant.delta'
  | 'assistant.message'
  | 'tool.started'
  | 'tool.output'
  | 'tool.completed'
  | 'approval.required'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'run.interrupted';

export interface HarnessEvent {
  runId: string;
  sessionId: string;
  messageId?: string;
  harnessSessionId?: string;
  type: HarnessEventType;
  payload?: unknown;
}

export interface HarnessLogEntry {
  at: string;
  source: 'renderer' | 'main' | 'harness' | 'dsh';
  message: string;
  data?: Record<string, unknown>;
}

export type AccountStatus = 'active' | 'disabled';
export type SessionStatus = 'active' | 'archived';

export interface AccountRecord {
  id: string;
  email: string | null;
  username: string | null;
  avatar: string | null;
  status: AccountStatus;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  metadataJson: string | null;
  deepseek: string | null;
  openai: string | null;
  selectedAi: string | null;
}

export interface WorkspaceRecord {
  id: string;
  accountId: string;
  name: string;
  rootPath: string;
  permissionPolicyJson: string;
  lastOpenedAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface SessionRecord {
  id: string;
  accountId: string;
  workspaceId: string | null;
  title: string | null;
  activeSkillId: string | null;
  status: SessionStatus;
  lastMessageId: string | null;
  lastMessageAt: number | null;
  summary: string | null;
  harnessSessionId: string | null;
  harnessInstanceId: string | null;
  harnessAiProvider: string | null;
  harnessAiModel: string | null;
  harnessAiBaseUrl: string | null;
  harnessAiConfigFingerprint: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type MessageStatus = 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface MessageRecord {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  retrySourceMessageId: string | null;
  retryPromptMessageId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertAccountInput {
  id: string;
  email?: string | null;
  username?: string | null;
  avatar?: string | null;
  status?: AccountStatus;
  metadata?: unknown;
}

export interface SaveWorkspaceInput {
  accountId: string;
  id?: string;
  name: string;
  rootPath: string;
  permissionPolicy?: unknown;
}

export interface CreateSessionInput {
  accountId: string;
  id?: string;
  workspaceId?: string | null;
  title?: string | null;
  activeSkillId?: string | null;
}

export interface RobbotApi {
  app: {
    isPackaged: boolean;
  };
  versions: {
    chrome: string;
    electron: string;
    node: string;
  };
  account: {
    upsertCurrent: (input: UpsertAccountInput) => Promise<AccountRecord>;
    get: (accountId: string) => Promise<AccountRecord>;
    updateAiConfig: (accountId: string, field: 'deepseek' | 'openai', value: unknown) => Promise<AccountRecord>;
    selectAi: (accountId: string, selectedAi: 'deepseek' | 'openai' | null) => Promise<AccountRecord>;
    resetHarness: (accountId: string) => Promise<void>;
  };
  workspace: {
    list: (accountId: string) => Promise<WorkspaceRecord[]>;
    save: (input: SaveWorkspaceInput) => Promise<WorkspaceRecord>;
    selectDirectory: (accountId: string) => Promise<WorkspaceRecord | null>;
    rename: (accountId: string, workspaceId: string, name: string) => Promise<WorkspaceRecord>;
    delete: (accountId: string, workspaceId: string) => Promise<void>;
  };
  session: {
    list: (accountId: string, workspaceId?: string | null) => Promise<SessionRecord[]>;
    create: (input: CreateSessionInput) => Promise<SessionRecord>;
    rename: (accountId: string, sessionId: string, title: string) => Promise<SessionRecord>;
    archive: (accountId: string, sessionId: string) => Promise<SessionRecord>;
    delete: (accountId: string, sessionId: string) => Promise<void>;
  };
  message: {
    list: (sessionId: string) => Promise<MessageRecord[]>;
  };
  harness: {
    getStatus: () => Promise<HarnessRuntimeStatus>;
    listActiveRuns: () => Promise<Record<string, ActiveRunRef>>;
    runPrompt: (input: HarnessRunInput) => Promise<HarnessRunResult>;
    retryMessage: (messageId: string) => Promise<HarnessRunResult>;
    cancel: (sessionId: string) => Promise<void>;
    approve: (sessionId: string, approvalId: string, approved: boolean) => Promise<void>;
    onLog: (listener: (entry: HarnessLogEntry) => void) => () => void;
    onEvent: (listener: (event: HarnessEvent) => void) => () => void;
  };
}

declare global {
  interface Window {
    robbot: RobbotApi;
  }
}
