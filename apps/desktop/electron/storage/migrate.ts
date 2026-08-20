import type BetterSqlite3 from 'better-sqlite3';

type Migration = {
  id: string;
  sql: string;
};

const MIGRATIONS: Migration[] = [
  {
    id: '0001_initial_product_storage',
    sql: `
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT,
        username TEXT,
        avatar TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login_at INTEGER,
        metadata_json TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_unique ON accounts(email);
      CREATE INDEX IF NOT EXISTS accounts_status_idx ON accounts(status);

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        permission_policy_json TEXT NOT NULL DEFAULT '{}',
        last_opened_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS workspaces_account_root_path_unique ON workspaces(account_id, root_path);
      CREATE INDEX IF NOT EXISTS workspaces_account_last_opened_idx ON workspaces(account_id, last_opened_at);
      CREATE INDEX IF NOT EXISTS workspaces_account_deleted_idx ON workspaces(account_id, deleted_at);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
        title TEXT,
        active_skill_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        last_message_id TEXT,
        last_message_at INTEGER,
        summary TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS sessions_account_last_message_idx ON sessions(account_id, last_message_at);
      CREATE INDEX IF NOT EXISTS sessions_workspace_last_message_idx ON sessions(workspace_id, last_message_at);
      CREATE INDEX IF NOT EXISTS sessions_account_status_idx ON sessions(account_id, status);
      CREATE INDEX IF NOT EXISTS sessions_account_deleted_idx ON sessions(account_id, deleted_at);
    `,
  },
  {
    id: '0002_runtime_session_and_messages',
    sql: `
      ALTER TABLE sessions ADD COLUMN harness_session_id TEXT;
      ALTER TABLE sessions ADD COLUMN harness_instance_id TEXT;

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_session_created_idx ON messages(session_id, created_at);
    `,
  },
  {
    id: '0003_message_retry_source',
    sql: `
      ALTER TABLE messages ADD COLUMN retry_source_message_id TEXT;
      ALTER TABLE messages ADD COLUMN retry_prompt_message_id TEXT;
      CREATE INDEX IF NOT EXISTS messages_retry_source_idx ON messages(retry_source_message_id);
    `,
  },
];

export function migrateDatabase(sqlite: BetterSqlite3.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS storage_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const appliedRows = sqlite.prepare('SELECT id FROM storage_migrations').all() as Array<{ id: string }>;
  const applied = new Set(appliedRows.map((row) => row.id));
  const insert = sqlite.prepare('INSERT INTO storage_migrations(id, applied_at) VALUES(?, ?)');

  const transaction = sqlite.transaction(() => {
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) {
        continue;
      }

      sqlite.exec(migration.sql);
      insert.run(migration.id, Date.now());
    }
  });

  transaction();
}
