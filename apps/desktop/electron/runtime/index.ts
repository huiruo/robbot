import { HarnessService } from '../main/harness/harness-service';
import { Database } from '../storage/database';
import { AccountRepository, SessionRepository, WorkspaceRepository } from '../storage/repositories';

export interface RuntimeServices {
  database: Database;
  accounts: AccountRepository;
  workspaces: WorkspaceRepository;
  sessions: SessionRepository;
  harness: HarnessService;
  dispose: () => Promise<void>;
}

export function initializeRuntime(): RuntimeServices {
  const database = new Database();
  const harness = new HarnessService();
  let disposed = false;
  const runtime: RuntimeServices = {
    database,
    accounts: new AccountRepository(database.db),
    workspaces: new WorkspaceRepository(database.db),
    sessions: new SessionRepository(database.db),
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
