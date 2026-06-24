import Database from 'better-sqlite3'
import { initSchema } from './schema'

export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = DELETE')   // rollback journal, NOT WAL (cloud-sync safe)
  db.pragma('foreign_keys = ON')
  initSchema(db)
  return db
}

export function closeDatabase(db: Database.Database): void {
  db.close()
}
