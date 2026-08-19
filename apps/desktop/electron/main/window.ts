import path from 'node:path';
import { app, BrowserWindow } from 'electron';

const rendererDevUrl = process.env.ROBBOT_RENDERER_DEV_URL;
const isDevelopment = process.env.NODE_ENV === 'development' || Boolean(rendererDevUrl);

// 生产模式用的。Vite renderer 构建后产物
function getPreloadPath(): string {
  return path.join(app.getAppPath(), 'dist-electron/preload/index.js');
}

// 生产模式用的。Vite renderer 构建后产物
function getRendererHtmlPath(): string {
  return path.join(app.getAppPath(), 'renderer/dist/index.html');
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (rendererDevUrl) {
    await win.loadURL(rendererDevUrl);
  } else {
    await win.loadFile(getRendererHtmlPath());
  }

  if (isDevelopment) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  return win;
}
