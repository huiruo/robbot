import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('robbot', {
  app: {
    isPackaged: process.env.NODE_ENV !== 'development',
  },
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
  account: {
    upsertCurrent: (input: unknown) => ipcRenderer.invoke('account:upsert-current', input),
    get: (accountId: string) => ipcRenderer.invoke('account:get', accountId),
    updateAiConfig: (accountId: string, field: 'deepseekKey' | 'chatgptKey', value: unknown) =>
      ipcRenderer.invoke('account:update-ai-config', accountId, field, value),
    selectAi: (accountId: string, selectedAi: 'deepseekKey' | 'chatgptKey' | null) =>
      ipcRenderer.invoke('account:select-ai', accountId, selectedAi),
  },
  workspace: {
    list: (accountId: string) => ipcRenderer.invoke('workspace:list', accountId),
    save: (input: unknown) => ipcRenderer.invoke('workspace:save', input),
    selectDirectory: (accountId: string) => ipcRenderer.invoke('workspace:select-directory', accountId),
    rename: (accountId: string, workspaceId: string, name: string) =>
      ipcRenderer.invoke('workspace:rename', accountId, workspaceId, name),
    delete: (accountId: string, workspaceId: string) => ipcRenderer.invoke('workspace:delete', accountId, workspaceId),
  },
  session: {
    list: (accountId: string, workspaceId?: string | null) => ipcRenderer.invoke('session:list', accountId, workspaceId),
    create: (input: unknown) => ipcRenderer.invoke('session:create', input),
    rename: (accountId: string, sessionId: string, title: string) =>
      ipcRenderer.invoke('session:rename', accountId, sessionId, title),
    archive: (accountId: string, sessionId: string) => ipcRenderer.invoke('session:archive', accountId, sessionId),
    delete: (accountId: string, sessionId: string) => ipcRenderer.invoke('session:delete', accountId, sessionId),
  },
  message: {
    list: (sessionId: string) => ipcRenderer.invoke('message:list', sessionId),
  },
  harness: {
    getStatus: () => ipcRenderer.invoke('harness:get-status'),
    listActiveRuns: () => ipcRenderer.invoke('harness:list-active-runs'),
    runPrompt: (input: unknown) => ipcRenderer.invoke('harness:run-prompt', input),
    retryMessage: (messageId: string) => ipcRenderer.invoke('harness:retry-message', messageId),
    cancel: (sessionId: string) => ipcRenderer.invoke('harness:cancel', sessionId),
    approve: (sessionId: string, approvalId: string, approved: boolean) =>
      ipcRenderer.invoke('harness:approve', sessionId, approvalId, approved),
    onLog: (listener: (entry: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, entry: unknown) => listener(entry);
      ipcRenderer.on('harness:log', handler);

      return () => {
        ipcRenderer.off('harness:log', handler);
      };
    },
    onEvent: (listener: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, harnessEvent: unknown) => listener(harnessEvent);
      ipcRenderer.on('harness:event', handler);

      return () => {
        ipcRenderer.off('harness:event', handler);
      };
    },
  },
});
