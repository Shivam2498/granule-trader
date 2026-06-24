import { copyFileSync, mkdirSync, readdirSync, unlinkSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { join, basename, extname } from 'path'

const LOCK = '.granule.lock'

export function createBackup(dbPath: string, backupDir: string, keepCount: number, stamp: string): string {
  mkdirSync(backupDir, { recursive: true })
  const name = basename(dbPath, extname(dbPath))
  const dest = join(backupDir, `${name}.${stamp}.db`)
  copyFileSync(dbPath, dest)
  const prefix = `${name}.`
  const backups = readdirSync(backupDir).filter(f => f.startsWith(prefix) && f.endsWith('.db')).sort()
  for (const old of backups.slice(0, Math.max(0, backups.length - keepCount)))
    unlinkSync(join(backupDir, old))
  return dest
}

export function acquireLock(dir: string, holder: string): { ok: boolean; existingHolder?: string } {
  const path = join(dir, LOCK)
  if (existsSync(path)) return { ok: false, existingHolder: readFileSync(path, 'utf8') }
  writeFileSync(path, `${holder} @ lock`)
  return { ok: true }
}

export function releaseLock(dir: string): void {
  const path = join(dir, LOCK)
  if (existsSync(path)) unlinkSync(path)
}
