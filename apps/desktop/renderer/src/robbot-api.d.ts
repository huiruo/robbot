export interface HarnessRuntimeStatus {
  status: 'missing' | 'not_installed' | 'ready' | 'running';
  runtimeRoot: string;
}

export interface HarnessRunResult {
  sessionId: string;
  text: string;
  events: Array<{ type: string; [key: string]: unknown }>;
}

export interface HarnessLogEntry {
  at: string;
  source: 'renderer' | 'main' | 'harness' | 'dsh';
  message: string;
  data?: Record<string, unknown>;
}

export interface RobbotApi {
  app: {
    isPackaged: boolean;
  };
  versions: {
    chrome: string;
    electron: string;
    node: string;
  };
  harness: {
    getStatus: () => Promise<HarnessRuntimeStatus>;
    runPrompt: (prompt: string) => Promise<HarnessRunResult>;
    onLog: (listener: (entry: HarnessLogEntry) => void) => () => void;
  };
}

declare global {
  interface Window {
    robbot: RobbotApi;
  }
}
