export interface HarnessRuntimeStatus {
  status: 'missing' | 'not_installed' | 'ready' | 'running';
  runtimeRoot: string;
}

export interface HarnessRunResult {
  sessionId: string;
  text: string;
  events: Array<{ type: string; [key: string]: unknown }>;
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
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
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
  };
  workspace: {
    list: (accountId: string) => Promise<WorkspaceRecord[]>;
    save: (input: SaveWorkspaceInput) => Promise<WorkspaceRecord>;
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
  harness: {
    getStatus: () => Promise<HarnessRuntimeStatus>;
    runPrompt: (prompt: string) => Promise<HarnessRunResult>;
    onLog: (listener: (entry: HarnessLogEntry) => void) => () => void;
  };
}

declare global {
  interface Window {
    robbot: RobbotApi;
  }
}
