export interface CreateSessionInput {
  workspacePath: string;
  profile?: string;
  metadata?: Record<string, unknown>;
}

export interface HarnessSession {
  id: string;
  workspacePath: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface RunInput {
  prompt: string;
  metadata?: Record<string, unknown> & {
    runMode?: 'sdk' | 'acp';
    historyBootstrap?: {
      messages: Array<{
        role: 'user' | 'assistant';
        content: string;
      }>;
    };
  };
}
