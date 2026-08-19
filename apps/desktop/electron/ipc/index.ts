import { ipcMain } from 'electron';

import type { RuntimeServices } from '../runtime';
import type { AccountStatus } from '../storage/repositories';

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

export function registerIpcHandlers(services: RuntimeServices): void {
  ipcMain.handle('account:upsert-current', (_event, input: UpsertAccountInput) => services.accounts.upsert(input));

  ipcMain.handle('workspace:list', (_event, accountId: string) => services.workspaces.list(accountId));
  ipcMain.handle('workspace:save', (_event, input: SaveWorkspaceInput) => services.workspaces.save(input));
  ipcMain.handle('workspace:rename', (_event, accountId: string, workspaceId: string, name: string) =>
    services.workspaces.rename(accountId, workspaceId, name),
  );
  ipcMain.handle('workspace:delete', (_event, accountId: string, workspaceId: string) =>
    services.workspaces.delete(accountId, workspaceId),
  );

  ipcMain.handle('session:list', (_event, accountId: string, workspaceId?: string | null) =>
    services.sessions.list(accountId, workspaceId),
  );
  ipcMain.handle('session:create', (_event, input: CreateSessionInput) => services.sessions.create(input));
  ipcMain.handle('session:rename', (_event, accountId: string, sessionId: string, title: string) =>
    services.sessions.rename(accountId, sessionId, title),
  );
  ipcMain.handle('session:archive', (_event, accountId: string, sessionId: string) =>
    services.sessions.archive(accountId, sessionId),
  );
  ipcMain.handle('session:delete', (_event, accountId: string, sessionId: string) =>
    services.sessions.delete(accountId, sessionId),
  );

  ipcMain.handle('harness:get-status', () => services.harness.getStatus());
  ipcMain.handle('harness:run-prompt', (event, prompt: string) => {
    services.harness.setLogSink((entry) => {
      event.sender.send('harness:log', entry);
    });
    services.harness.setEventSink((harnessEvent) => {
      event.sender.send('harness:event', harnessEvent);
    });

    return services.harness.runPrompt(prompt);
  });
}
