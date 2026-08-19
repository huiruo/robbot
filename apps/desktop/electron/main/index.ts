import { app, BrowserWindow } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';

import { registerIpcHandlers } from '../ipc';
import { initializeRuntime } from '../runtime';
import { createMainWindow } from './window';

if (squirrelStartup) {
  app.quit();
}

async function bootstrap(): Promise<void> {
  const services = initializeRuntime();
  registerIpcHandlers(services);

  app.on('before-quit', () => {
    void services.harness.dispose();
  });

  await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
}

app.whenReady().then(bootstrap).catch((error: unknown) => {
  console.error('Failed to bootstrap Electron app:', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
