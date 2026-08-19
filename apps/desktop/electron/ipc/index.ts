import { ipcMain } from 'electron';

import type { RuntimeServices } from '../runtime';

export function registerIpcHandlers(services: RuntimeServices): void {
  ipcMain.handle('harness:get-status', () => services.harness.getStatus());
  ipcMain.handle('harness:run-prompt', (event, prompt: string) => {
    services.harness.setLogSink((entry) => {
      event.sender.send('harness:log', entry);
    });

    return services.harness.runPrompt(prompt);
  });
}
