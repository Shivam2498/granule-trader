import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createBackup, acquireLock, releaseLock } from '../../src/main/core/backup'

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
})
