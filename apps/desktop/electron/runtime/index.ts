import { HarnessService } from '../main/harness/harness-service';
import { AuthSessionService } from '../main/auth/auth-service';
import { AccountDshEnvironmentService } from '../main/harness/account-dsh-environment-service';
import { Database } from '../storage/database';
import { AccountRepository, MessageRepository, SessionEventRepository, SessionRepository, WorkspaceRepository } from '../storage/repositories';

export interface RuntimeServices {
  database: Database;
  auth: AuthSessionService;
  accounts: AccountRepository;
  workspaces: WorkspaceRepository;
  sessions: SessionRepository;
  messages: MessageRepository;
  sessionEvents: SessionEventRepository;
  harness: HarnessService;
  dispose: () => Promise<void>;
}

export function initializeRuntime(): RuntimeServices {
  const database = new Database();
  const accounts = new AccountRepository(database.db);
  const workspaces = new WorkspaceRepository(database.db);
  const sessions = new SessionRepository(database.db);
  const messages = new MessageRepository(database.db);
  const sessionEvents = new SessionEventRepository(database.db);
  const accountDshEnvironment = new AccountDshEnvironmentService();
  const auth = new AuthSessionService(accounts);
  const harness = new HarnessService({ accounts, sessions, workspaces, messages, sessionEvents, accountDshEnvironment });
  let disposed = false;
  const runtime: RuntimeServices = {
    database,
    auth,
    accounts,
    workspaces,
    sessions,
    messages,
    sessionEvents,
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
