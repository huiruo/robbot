import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { migrateDatabase } from './migrate';
import { schema } from './schema';

export type DesktopDatabase = BetterSQLite3Database<typeof schema>;

export class Database {
  private readonly sqlite: BetterSqlite3.Database;
  public readonly db: DesktopDatabase;
  public readonly dbPath: string;

  constructor(options?: { dbPath?: string }) {
    const storagePath = options?.dbPath ? path.dirname(options.dbPath) : app.getPath('userData');
    this.dbPath = options?.dbPath ?? path.join(storagePath, 'robbot.db');

    fs.mkdirSync(storagePath, { recursive: true });

    this.sqlite = new BetterSqlite3(this.dbPath);
    configureDatabase(this.sqlite);
    migrateDatabase(this.sqlite);
    this.db = drizzle(this.sqlite, { schema });
  }

  close(): void {
    this.sqlite.close();
  }
}

function configureDatabase(sqlite: BetterSqlite3.Database): void {
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
}
