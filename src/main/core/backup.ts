import { copyFileSync, mkdirSync, readdirSync, unlinkSync, existsSync, readFileSync, openSync, closeSync, writeSync } from 'fs'
import { join, basename, extname } from 'path'

const LOCK = '.granule.lock'

export function createBackup(dbPath: string, backupDir: string, keepCount: number, stamp: string): string {
  mkdirSync(backupDir, { recursive: true })
  const name = basename(dbPath, extname(dbPath))
  const dest = join(backupDir, `${name}.${stamp}.db`)
  copyFileSync(dbPath, dest)
  const prefix = `${name}.`
  const backups = readdirSync(backupDir).filter(f => f.startsWith(prefix) && f.endsWith('.db')).sort()
  // Clamp to at least 1 so a misconfigured/non-numeric setting can never delete the backup
  // we just made (keepCount = 0 would wipe everything; NaN would disable pruning entirely).
  const keep = Number.isFinite(keepCount) && keepCount > 0 ? Math.floor(keepCount) : 1
  for (const old of backups.slice(0, Math.max(0, backups.length - keep)))
    unlinkSync(join(backupDir, old))
  return dest
}

/** Returns true if the given process is alive (or belongs to another user). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e: any) {
    return e.code === 'EPERM'
  }
}

/**
 * Atomically acquires a per-folder lock file using O_CREAT|O_EXCL semantics.
 * The lock file contains `${holder}\n${process.pid}`.
 * Returns { ok: true } on success, or { ok: false, existingHolder, existingPid } if
 * the file already exists (EEXIST).
 */
export function acquireLock(dir: string, holder: string): { ok: boolean; existingHolder?: string; existingPid?: number | null } {
  const path = join(dir, LOCK)
  try {
    const fd = openSync(path, 'wx')
    writeSync(fd, `${holder}\n${process.pid}`)
    closeSync(fd)
    return { ok: true }
  } catch (e: any) {
    if (e.code === 'EEXIST') {
      try {
        const content = readFileSync(path, 'utf8').trim()
        const [host, pidStr] = content.split('\n')
        const parsed = pidStr ? parseInt(pidStr, 10) : NaN
        const existingPid = Number.isNaN(parsed) ? null : parsed
        return { ok: false, existingHolder: host ?? '', existingPid }
      } catch {
        return { ok: false, existingHolder: '', existingPid: null }
      }
    }
    throw e
  }
}

export function releaseLock(dir: string): void {
  const path = join(dir, LOCK)
  if (existsSync(path)) unlinkSync(path)
}
