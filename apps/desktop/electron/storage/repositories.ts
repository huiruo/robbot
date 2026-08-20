import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import type { DesktopDatabase } from './database';
import { accounts, messages, sessions, workspaces } from './schema';

export type AccountStatus = 'active' | 'disabled';
export type SessionStatus = 'active' | 'archived';
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type MessageStatus = 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

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
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

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

export class AccountRepository {
  constructor(private readonly db: DesktopDatabase) {}

  upsert(input: {
    id: string;
    email?: string | null;
    username?: string | null;
    avatar?: string | null;
    status?: AccountStatus;
    metadata?: unknown;
  }): AccountRecord {
    const now = Date.now();
    const existing = this.db.select().from(accounts).where(eq(accounts.id, input.id)).get();

    this.db
      .insert(accounts)
      .values({
        id: input.id,
        email: input.email ?? null,
        username: input.username ?? null,
        avatar: input.avatar ?? null,
        status: input.status ?? 'active',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        lastLoginAt: now,
        metadataJson: stringifyMetadata(input.metadata),
      })
      .onConflictDoUpdate({
        target: accounts.id,
        set: {
          email: input.email ?? null,
          username: input.username ?? null,
          avatar: input.avatar ?? null,
          status: input.status ?? existing?.status ?? 'active',
          updatedAt: now,
          lastLoginAt: now,
          metadataJson: stringifyMetadata(input.metadata),
        },
      })
      .run();

    return requireRecord(this.db.select().from(accounts).where(eq(accounts.id, input.id)).get(), `Unknown account: ${input.id}`);
  }

  get(accountId: string): AccountRecord {
    return requireRecord(this.db.select().from(accounts).where(eq(accounts.id, accountId)).get(), `Unknown account: ${accountId}`);
  }

  updateAiConfig(accountId: string, field: 'deepseek' | 'openai', value: unknown): AccountRecord {
    this.db.update(accounts).set({ [field]: JSON.stringify(value), updatedAt: Date.now() }).where(eq(accounts.id, accountId)).run();
    return this.get(accountId);
  }

  selectAi(accountId: string, selectedAi: 'deepseek' | 'openai' | null): AccountRecord {
    this.db.update(accounts).set({ selectedAi, updatedAt: Date.now() }).where(eq(accounts.id, accountId)).run();
    return this.get(accountId);
  }
}

export class WorkspaceRepository {
  constructor(private readonly db: DesktopDatabase) {}

  list(accountId: string): WorkspaceRecord[] {
    return this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.accountId, accountId), isNull(workspaces.deletedAt)))
      .orderBy(desc(workspaces.lastOpenedAt))
      .all();
  }

  save(input: {
    accountId: string;
    id?: string;
    name: string;
    rootPath: string;
    permissionPolicy?: unknown;
  }): WorkspaceRecord {
    const now = Date.now();
    const rootPath = normalizeWorkspacePath(input.rootPath);
    const id = input.id ?? randomUUID();
    const existing = this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.accountId, input.accountId), eq(workspaces.rootPath, rootPath)))
      .get();

    this.db
      .insert(workspaces)
      .values({
        id,
        accountId: input.accountId,
        name: input.name,
        rootPath,
        permissionPolicyJson: JSON.stringify(input.permissionPolicy ?? {}),
        lastOpenedAt: now,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      })
      .onConflictDoUpdate({
        target: [workspaces.accountId, workspaces.rootPath],
        set: {
          name: input.name,
          permissionPolicyJson: JSON.stringify(input.permissionPolicy ?? {}),
          lastOpenedAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      })
      .run();

    return requireRecord(
      this.db.select().from(workspaces).where(and(eq(workspaces.accountId, input.accountId), eq(workspaces.rootPath, rootPath))).get(),
      `Unknown workspace: ${rootPath}`,
    );
  }

  rename(accountId: string, workspaceId: string, name: string): WorkspaceRecord {
    this.db
      .update(workspaces)
      .set({ name, updatedAt: Date.now() })
      .where(and(eq(workspaces.accountId, accountId), eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
      .run();

    return this.get(accountId, workspaceId);
  }

  delete(accountId: string, workspaceId: string): void {
    this.db
      .update(workspaces)
      .set({ deletedAt: Date.now(), updatedAt: Date.now() })
      .where(and(eq(workspaces.accountId, accountId), eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
      .run();
  }

  get(accountId: string, workspaceId: string): WorkspaceRecord {
    return requireRecord(
      this.db
        .select()
        .from(workspaces)
        .where(and(eq(workspaces.accountId, accountId), eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
        .get(),
      `Unknown workspace: ${workspaceId}`,
    );
  }
}

export class SessionRepository {
  constructor(private readonly db: DesktopDatabase) {}

  list(accountId: string, workspaceId?: string | null): SessionRecord[] {
    const predicates = [eq(sessions.accountId, accountId), isNull(sessions.deletedAt)];
    if (workspaceId !== undefined) {
      predicates.push(workspaceId === null ? isNull(sessions.workspaceId) : eq(sessions.workspaceId, workspaceId));
    }

    return this.db.select().from(sessions).where(and(...predicates)).orderBy(desc(sessions.lastMessageAt), desc(sessions.updatedAt)).all();
  }

  create(input: {
    accountId: string;
    id?: string;
    workspaceId?: string | null;
    title?: string | null;
    activeSkillId?: string | null;
  }): SessionRecord {
    const now = Date.now();
    const id = input.id ?? randomUUID();

    this.db
      .insert(sessions)
      .values({
        id,
        accountId: input.accountId,
        workspaceId: input.workspaceId ?? null,
        title: input.title ?? null,
        activeSkillId: input.activeSkillId ?? null,
        status: 'active',
        lastMessageId: null,
        lastMessageAt: null,
        summary: null,
        harnessSessionId: null,
        harnessInstanceId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .run();

    return this.get(input.accountId, id);
  }

  rename(accountId: string, sessionId: string, title: string): SessionRecord {
    this.db
      .update(sessions)
      .set({ title, updatedAt: Date.now() })
      .where(and(eq(sessions.accountId, accountId), eq(sessions.id, sessionId), isNull(sessions.deletedAt)))
      .run();

    return this.get(accountId, sessionId);
  }

  archive(accountId: string, sessionId: string): SessionRecord {
    this.db
      .update(sessions)
      .set({ status: 'archived', updatedAt: Date.now() })
      .where(and(eq(sessions.accountId, accountId), eq(sessions.id, sessionId), isNull(sessions.deletedAt)))
      .run();

    return this.get(accountId, sessionId);
  }

  delete(accountId: string, sessionId: string): void {
    this.db
      .update(sessions)
      .set({ deletedAt: Date.now(), updatedAt: Date.now() })
      .where(and(eq(sessions.accountId, accountId), eq(sessions.id, sessionId), isNull(sessions.deletedAt)))
      .run();
  }

  attachHarnessSession(accountId: string, sessionId: string, input: {
    harnessSessionId: string;
    harnessInstanceId: string;
  }): SessionRecord {
    this.db
      .update(sessions)
      .set({
        harnessSessionId: input.harnessSessionId,
        harnessInstanceId: input.harnessInstanceId,
        updatedAt: Date.now(),
      })
      .where(and(eq(sessions.accountId, accountId), eq(sessions.id, sessionId), isNull(sessions.deletedAt)))
      .run();

    return this.get(accountId, sessionId);
  }

  touchAfterMessage(accountId: string, sessionId: string, input: {
    lastMessageId: string;
    lastMessageAt: number;
    title?: string | null;
  }): SessionRecord {
    const set: {
      lastMessageId: string;
      lastMessageAt: number;
      updatedAt: number;
      title?: string | null;
    } = {
      lastMessageId: input.lastMessageId,
      lastMessageAt: input.lastMessageAt,
      updatedAt: Date.now(),
    };

    if (input.title !== undefined) {
      set.title = input.title;
    }

    this.db
      .update(sessions)
      .set(set)
      .where(and(eq(sessions.accountId, accountId), eq(sessions.id, sessionId), isNull(sessions.deletedAt)))
      .run();

    return this.get(accountId, sessionId);
  }

  get(accountId: string, sessionId: string): SessionRecord {
    return requireRecord(
      this.db
        .select()
        .from(sessions)
        .where(and(eq(sessions.accountId, accountId), eq(sessions.id, sessionId), isNull(sessions.deletedAt)))
        .get(),
      `Unknown session: ${sessionId}`,
    );
  }

  getById(sessionId: string): SessionRecord {
    return requireRecord(
      this.db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), isNull(sessions.deletedAt)))
        .get(),
      `Unknown session: ${sessionId}`,
    );
  }
}

export class MessageRepository {
  constructor(private readonly db: DesktopDatabase) {}

  list(sessionId: string): MessageRecord[] {
    return this.db.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(asc(messages.createdAt)).all();
  }

  create(input: {
    id?: string;
    sessionId: string;
    role: MessageRole;
    content: string;
    status?: MessageStatus;
    retrySourceMessageId?: string | null;
    retryPromptMessageId?: string | null;
    createdAt?: number;
  }): MessageRecord {
    const now = input.createdAt ?? Date.now();
    const id = input.id ?? randomUUID();

    this.db
      .insert(messages)
      .values({
        id,
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        status: input.status ?? 'completed',
        retrySourceMessageId: input.retrySourceMessageId ?? null,
        retryPromptMessageId: input.retryPromptMessageId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return this.get(id);
  }

  updateContent(messageId: string, content: string): MessageRecord {
    this.db.update(messages).set({ content, updatedAt: Date.now() }).where(eq(messages.id, messageId)).run();
    return this.get(messageId);
  }

  updateStatus(messageId: string, status: MessageStatus, content?: string): MessageRecord {
    this.db
      .update(messages)
      .set({
        ...(content === undefined ? {} : { content }),
        status,
        updatedAt: Date.now(),
      })
      .where(eq(messages.id, messageId))
      .run();

    return this.get(messageId);
  }

  updateStreamingStatus(messageId: string, status: Exclude<MessageStatus, 'streaming'>, content?: string): MessageRecord {
    this.db
      .update(messages)
      .set({
        ...(content === undefined ? {} : { content }),
        status,
        updatedAt: Date.now(),
      })
      .where(and(eq(messages.id, messageId), eq(messages.status, 'streaming')))
      .run();

    return this.get(messageId);
  }

  markStreamingInterrupted(): void {
    this.db
      .update(messages)
      .set({ status: 'interrupted', updatedAt: Date.now() })
      .where(eq(messages.status, 'streaming'))
      .run();
  }

  get(messageId: string): MessageRecord {
    return requireRecord(this.db.select().from(messages).where(eq(messages.id, messageId)).get(), `Unknown message: ${messageId}`);
  }

  findPreviousUserMessage(sessionId: string, beforeCreatedAt: number): MessageRecord | null {
    return this.db
      .select()
      .from(messages)
      .where(and(eq(messages.sessionId, sessionId), eq(messages.role, 'user')))
      .orderBy(desc(messages.createdAt))
      .all()
      .find((message) => message.createdAt < beforeCreatedAt) ?? null;
  }
}

function normalizeWorkspacePath(rootPath: string): string {
  return fs.realpathSync.native(path.resolve(rootPath));
}

function stringifyMetadata(metadata: unknown): string | null {
  return metadata === undefined ? null : JSON.stringify(metadata);
}

function requireRecord<T>(record: T | undefined, message: string): T {
  if (!record) {
    throw new Error(message);
  }

  return record;
}
