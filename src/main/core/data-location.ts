import { join } from 'path'
import { openDatabase, closeDatabase } from '../db/connection'
import { getSettings, saveSettings } from './reference'

export function dbPathFor(folder: string): string { return join(folder, 'granule-trader.db') }

// The active data folder is recorded as the `data_folder` pointer inside the
// bootstrap (userData) DB — the fixed location opened at every launch. Returns
// the pointer when it is set and different, otherwise the bootstrap folder itself.
export function resolveDataFolder(bootstrapFolder: string): string {
  const boot = openDatabase(dbPathFor(bootstrapFolder))
  try {
    const ptr = getSettings(boot).data_folder
    if (ptr && ptr !== bootstrapFolder) {
      try {
        const check = openDatabase(dbPathFor(ptr))
        closeDatabase(check)
        return ptr
      } catch (e) {
        console.warn('resolveDataFolder: chosen data folder is unavailable, falling back to bootstrap:', e)
        return bootstrapFolder
      }
    }
    return bootstrapFolder
  } finally { closeDatabase(boot) }
}

// Record the chosen folder as the active-data pointer in the bootstrap DB, so the
// next launch can find it (without this, boot reads an empty userData DB and shows
// onboarding every time). Also stamps the pointer into the destination DB so the
// data file is self-describing.
export function rememberDataFolder(bootstrapFolder: string, folder: string): void {
  const boot = openDatabase(dbPathFor(bootstrapFolder))
  try { saveSettings(boot, { data_folder: folder }) } finally { closeDatabase(boot) }
  if (folder !== bootstrapFolder) {
    const dest = openDatabase(dbPathFor(folder))
    try { saveSettings(dest, { data_folder: folder }) } finally { closeDatabase(dest) }
  }
}
