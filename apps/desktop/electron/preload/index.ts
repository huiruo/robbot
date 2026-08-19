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
  },
  workspace: {
    list: (accountId: string) => ipcRenderer.invoke('workspace:list', accountId),
    save: (input: unknown) => ipcRenderer.invoke('workspace:save', input),
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
  harness: {
    getStatus: () => ipcRenderer.invoke('harness:get-status'),
    runPrompt: (prompt: string) => ipcRenderer.invoke('harness:run-prompt', prompt),
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
