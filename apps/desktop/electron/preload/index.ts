import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('robbot', {
  app: {
    isPackaged: process.env.NODE_ENV !== 'development',
  },
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
});
