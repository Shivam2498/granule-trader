import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createBackup, acquireLock, releaseLock, pidAlive } from '../../src/main/core/backup'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gt-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('createBackup', () => {
  it('copies the db and prunes beyond keepCount', () => {
    const dbPath = join(dir, 'data.db')
    writeFileSync(dbPath, 'x')
    const backupDir = join(dir, 'backups')
    for (const t of ['001', '002', '003']) createBackup(dbPath, backupDir, 2, t)
    const files = readdirSync(backupDir).sort()
    expect(files).toEqual(['data.002.db', 'data.003.db'])
  })

  it('never deletes the backup it just made when keepCount is 0 or non-numeric', () => {
    const dbPath = join(dir, 'data.db')
    writeFileSync(dbPath, 'x')
    const backupDir = join(dir, 'backups')
    const zeroDest = createBackup(dbPath, backupDir, 0, '001')
    expect(existsSync(zeroDest)).toBe(true)
    const nanDest = createBackup(dbPath, backupDir, NaN as unknown as number, '002')
    expect(existsSync(nanDest)).toBe(true)
    // keepCount=1 keeps only the newest
    createBackup(dbPath, backupDir, 1, '003')
    expect(readdirSync(backupDir).sort()).toEqual(['data.003.db'])
  })
})

describe('lock', () => {
  it('acquires, blocks a second holder, then releases', () => {
    expect(acquireLock(dir, 'MacA').ok).toBe(true)
    const second = acquireLock(dir, 'MacB')
    expect(second.ok).toBe(false)
    expect(second.existingHolder).toContain('MacA')
    releaseLock(dir)
    expect(existsSync(join(dir, '.granule.lock'))).toBe(false)
  })

  it('second acquire returns existingPid', () => {
    acquireLock(dir, 'MacA')
    const second = acquireLock(dir, 'MacB')
    expect(second.ok).toBe(false)
    expect(typeof second.existingPid).toBe('number')
    releaseLock(dir)
  })

  it('lock file contains the current pid', () => {
    acquireLock(dir, 'TestHost')
    const content = readFileSync(join(dir, '.granule.lock'), 'utf8')
    expect(content).toContain(String(process.pid))
    releaseLock(dir)
  })

  it('releaseLock allows re-acquisition', () => {
    acquireLock(dir, 'MacA')
    releaseLock(dir)
    expect(acquireLock(dir, 'MacB').ok).toBe(true)
    releaseLock(dir)
  })
})

describe('pidAlive', () => {
  it('returns true for the current process', () => {
    expect(pidAlive(process.pid)).toBe(true)
  })

  it('returns false for a pid that does not exist', () => {
    // 999999999 is well above any platform's pid_max; kill(pid, 0) will throw ESRCH or EINVAL
    expect(pidAlive(999999999)).toBe(false)
  })
})
