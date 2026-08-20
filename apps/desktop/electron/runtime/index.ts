import { HarnessService } from '../main/harness/harness-service';
import { Database } from '../storage/database';
import { AccountRepository, MessageRepository, SessionRepository, WorkspaceRepository } from '../storage/repositories';

export interface RuntimeServices {
  database: Database;
  accounts: AccountRepository;
  workspaces: WorkspaceRepository;
  sessions: SessionRepository;
  messages: MessageRepository;
  harness: HarnessService;
  dispose: () => Promise<void>;
}

export function initializeRuntime(): RuntimeServices {
  const database = new Database();
  const accounts = new AccountRepository(database.db);
  const workspaces = new WorkspaceRepository(database.db);
  const sessions = new SessionRepository(database.db);
  const messages = new MessageRepository(database.db);
  const harness = new HarnessService({ accounts, sessions, workspaces, messages });
  let disposed = false;
  const runtime: RuntimeServices = {
    database,
    accounts,
    workspaces,
    sessions,
    messages,
    harness,
    dispose: async () => {
      if (disposed) {
        return;
      }

      disposed = true;
      await harness.dispose();
      database.close();
    },
  };

  return runtime;
}
