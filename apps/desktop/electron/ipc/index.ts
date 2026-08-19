import { ipcMain } from 'electron';

import type { RuntimeServices } from '../runtime';

export function registerIpcHandlers(services: RuntimeServices): void {
  ipcMain.handle('harness:get-status', () => services.harness.getStatus());
}
