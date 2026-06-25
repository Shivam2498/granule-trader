import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, closeDatabase } from '../../src/main/db/connection'
import { getSettings, saveSettings } from '../../src/main/core/reference'
import { dbPathFor, resolveDataFolder, rememberDataFolder } from '../../src/main/core/data-location'

let bootstrap: string
let chosen: string
beforeEach(() => {
  bootstrap = mkdtempSync(join(tmpdir(), 'gt-boot-'))
  chosen = mkdtempSync(join(tmpdir(), 'gt-data-'))
})
afterEach(() => {
  rmSync(bootstrap, { recursive: true, force: true })
  rmSync(chosen, { recursive: true, force: true })
})

describe('data-location pointer', () => {
  it('defaults to the bootstrap folder when no pointer is set', () => {
    expect(resolveDataFolder(bootstrap)).toBe(bootstrap)
  })

  it('persists the chosen folder so a later boot resolves to it (regression: onboarding every launch)', () => {
    // Onboarding: choose a folder, then save business details into the active (chosen) DB.
    rememberDataFolder(bootstrap, chosen)
    const active = openDatabase(dbPathFor(chosen))
    try { saveSettings(active, { home_state: 'Gujarat' }) } finally { closeDatabase(active) }

    // Next launch: the bootstrap DB must point at the chosen folder, which has home_state.
    expect(resolveDataFolder(bootstrap)).toBe(chosen)
    const boot = openDatabase(dbPathFor(resolveDataFolder(bootstrap)))
    try { expect(getSettings(boot).home_state).toBe('Gujarat') } finally { closeDatabase(boot) }
  })

  it('stamps the pointer into the destination DB too (self-describing)', () => {
    rememberDataFolder(bootstrap, chosen)
    const dest = openDatabase(dbPathFor(chosen))
    try { expect(getSettings(dest).data_folder).toBe(chosen) } finally { closeDatabase(dest) }
  })
})
