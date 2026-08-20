import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import path from 'node:path';

import type { RuntimeServices } from '../runtime';
import type { AccountStatus } from '../storage/repositories';
import type { HarnessRunInput, HarnessWarmupInput } from '../main/harness/harness-service';

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
  services.harness.setLogSink((entry) => {
    broadcast('harness:log', entry);
  });
  services.harness.setEventSink((event) => {
    broadcast('harness:event', event);
  });

  ipcMain.handle('account:upsert-current', (_event, input: UpsertAccountInput) => services.accounts.upsert(input));
  ipcMain.handle('account:get', (_event, accountId: string) => services.accounts.get(accountId));
  ipcMain.handle('account:update-ai-config', (_event, accountId: string, field: 'deepseek' | 'openai', value: unknown) =>
    services.accounts.updateAiConfig(accountId, field, value),
  );
  ipcMain.handle('account:select-ai', (_event, accountId: string, selectedAi: 'deepseek' | 'openai' | null) =>
    services.accounts.selectAi(accountId, selectedAi),
  );
  ipcMain.handle('account:reset-harness', (_event, accountId: string) => services.harness.resetForAccount(accountId));

  ipcMain.handle('workspace:list', (_event, accountId: string) => services.workspaces.list(accountId));
  ipcMain.handle('workspace:save', (_event, input: SaveWorkspaceInput) => services.workspaces.save(input));
  ipcMain.handle('workspace:select-directory', async (event, accountId: string) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      properties: ['openDirectory'],
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    const rootPath = result.filePaths[0];
    return services.workspaces.save({
      accountId,
      rootPath,
      name: path.basename(rootPath) || rootPath,
      permissionPolicy: {},
    });
  });
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

  ipcMain.handle('message:list', (_event, sessionId: string) => services.messages.list(sessionId));
  ipcMain.handle('session-events:list', (_event, sessionId: string) => services.sessionEvents.list(sessionId));

  ipcMain.handle('harness:get-status', () => services.harness.getStatus());
  ipcMain.handle('harness:list-active-runs', () => services.harness.getActiveRuns());
  ipcMain.handle('harness:warmup-runtime', (_event, input: HarnessWarmupInput) => services.harness.warmup(input));
  ipcMain.handle('harness:run-prompt', (_event, input: HarnessRunInput) => services.harness.runPrompt(input));
  ipcMain.handle('harness:retry-message', (_event, messageId: string) => services.harness.retryMessage(messageId));
  ipcMain.handle('harness:cancel', (_event, sessionId: string) => services.harness.cancel(sessionId));
  ipcMain.handle('harness:approve', (_event, sessionId: string, approvalId: string, approved: boolean) =>
    services.harness.approve(sessionId, { approvalId, approved }),
  );
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}
