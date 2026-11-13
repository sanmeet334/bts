import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import { SCHEMA_SQL } from './schema.js';
import { seedDatabase } from './seed.js';

let dbInstance: Database.Database | null = null;

export function getDb(customPath?: string): Database.Database {
  if (dbInstance) return dbInstance;

  const targetPath = customPath || env.databasePath;
  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(targetPath);
  db.pragma('foreign_keys = ON');
  if (targetPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }

  db.exec(SCHEMA_SQL);
  dbInstance = db;

  const userCount = (
    db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }
  ).cnt;
  if (userCount === 0) {
    seedDatabase(db);
  }

  return dbInstance;
}

export function resetDbForTests(): Database.Database {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  return getDb(':memory:');
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
