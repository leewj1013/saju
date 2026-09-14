// SQLite (Node 내장 node:sqlite). ponytail: 서버 1대 · 파일 1개. 서버를 여러 대로 늘리면 서버형 DB로 옮긴다
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../db/migrations');

export function openDb(file: string): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

/** db/migrations/*.sql을 파일 이름 순서로 한 번씩 적용 */
export function migrate(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  const applied = new Set((db.prepare('SELECT name FROM schema_migration').all() as { name: string }[]).map(r => r.name));
  for (const name of fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()) {
    if (applied.has(name)) continue;
    transaction(db, () => {
      db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8'));
      db.prepare('INSERT INTO schema_migration (name) VALUES (?)').run(name);
    });
  }
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
