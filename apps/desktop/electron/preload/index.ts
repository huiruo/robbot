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
  },
});
