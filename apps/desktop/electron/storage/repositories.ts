import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';

import type { DesktopDatabase } from './database';
import { accounts, sessions, workspaces } from './schema';

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

    return this.require(accountId, workspaceId);
  }

  delete(accountId: string, workspaceId: string): void {
    this.db
      .update(workspaces)
      .set({ deletedAt: Date.now(), updatedAt: Date.now() })
      .where(and(eq(workspaces.accountId, accountId), eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
      .run();
  }

  private require(accountId: string, workspaceId: string): WorkspaceRecord {
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
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .run();

    return this.require(input.accountId, id);
  }

  rename(accountId: string, sessionId: string, title: string): SessionRecord {
    this.db
      .update(sessions)
      .set({ title, updatedAt: Date.now() })
      .where(and(eq(sessions.accountId, accountId), eq(sessions.id, sessionId), isNull(sessions.deletedAt)))
      .run();

    return this.require(accountId, sessionId);
  }

  archive(accountId: string, sessionId: string): SessionRecord {
    this.db
      .update(sessions)
      .set({ status: 'archived', updatedAt: Date.now() })
      .where(and(eq(sessions.accountId, accountId), eq(sessions.id, sessionId), isNull(sessions.deletedAt)))
      .run();

    return this.require(accountId, sessionId);
  }

  delete(accountId: string, sessionId: string): void {
    this.db
      .update(sessions)
      .set({ deletedAt: Date.now(), updatedAt: Date.now() })
      .where(and(eq(sessions.accountId, accountId), eq(sessions.id, sessionId), isNull(sessions.deletedAt)))
      .run();
  }

  private require(accountId: string, sessionId: string): SessionRecord {
    return requireRecord(
      this.db
        .select()
        .from(sessions)
        .where(and(eq(sessions.accountId, accountId), eq(sessions.id, sessionId), isNull(sessions.deletedAt)))
        .get(),
      `Unknown session: ${sessionId}`,
    );
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
