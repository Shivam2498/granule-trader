import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { hostname } from 'os'
import type Database from 'better-sqlite3'
import { openDatabase, closeDatabase } from './db/connection'
import { getSettings } from './core/reference'
import { dbPathFor, resolveDataFolder, rememberDataFolder } from './core/data-location'
import { createBackup, acquireLock, releaseLock, pidAlive } from './core/backup'
import { registerIpc } from './ipc'

let db: Database.Database
let dbPath: string
let dataFolder: string
let lockAcquiredByUs = false

function openIn(folder: string): void {
  if (db) closeDatabase(db)
  dataFolder = folder
  dbPath = dbPathFor(folder)
  db = openDatabase(dbPath)
}

// Switch the active data folder and persist the pointer in the bootstrap (userData)
// DB, so the next launch reopens here instead of falling back to onboarding.
function setDataFolder(folder: string): void {
  // Release lock on outgoing folder before switching.
  if (lockAcquiredByUs) releaseLock(dataFolder)
  lockAcquiredByUs = false
  rememberDataFolder(app.getPath('userData'), folder)
  openIn(folder)
  // Acquire lock on new folder; reclaim any stale lock unconditionally so the
  // new folder is never left unlocked after a successful switch.
  const switchLock = acquireLock(dataFolder, hostname())
  if (!switchLock.ok) {
    releaseLock(dataFolder)
    acquireLock(dataFolder, hostname())
  }
  lockAcquiredByUs = true
}

function bootstrapData(): void {
  // First launch with no chosen folder: use userData until the user picks one in Settings/FirstRun.
  // resolveDataFolder reads the data_folder pointer recorded in the userData DB.
  openIn(resolveDataFolder(app.getPath('userData')))
  const lock = acquireLock(dataFolder, hostname())
  if (!lock.ok) {
    const holder = (lock.existingHolder ?? '').trim()
    if (holder === hostname()) {
      const holderPid = lock.existingPid ?? null
      if (holderPid !== null && pidAlive(holderPid)) {
        // Same machine AND the locking process is still alive — genuinely open elsewhere.
        const choice = dialog.showMessageBoxSync({
          type: 'warning',
          buttons: ['Quit', 'Open anyway'],
          defaultId: 0, cancelId: 0,
          title: 'Data may be open elsewhere',
          message: `This data is already open on this machine (PID ${holderPid}).`,
          detail: 'Open anyway only if you are sure the other instance is closed. Opening it twice at once can corrupt the file.'
        })
        if (choice === 0) { app.quit(); return }
        releaseLock(dataFolder); acquireLock(dataFolder, hostname())
        lockAcquiredByUs = true
      } else {
        // Same machine but PID is dead (or absent) — stale crash lock; reclaim silently.
        releaseLock(dataFolder); acquireLock(dataFolder, hostname())
        lockAcquiredByUs = true
      }
    } else {
      // Spec §4: a DIFFERENT machine holds the lock — warn; allow "Open anyway" only if
      // the user is sure it's closed there (opening on two machines at once can corrupt the file).
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        buttons: ['Quit', 'Open anyway'],
        defaultId: 0, cancelId: 0,
        title: 'Data may be open elsewhere',
        message: `This data is currently open on ${holder}.`,
        detail: 'Open anyway only if you are sure it is closed there. Opening it on two machines at once can corrupt the file.'
      })
      if (choice === 0) { app.quit(); return }
      releaseLock(dataFolder); acquireLock(dataFolder, hostname())   // Open anyway: replace the lock
      lockAcquiredByUs = true
    }
  } else {
    lockAcquiredByUs = true
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  try { createBackup(dbPath, join(dataFolder, 'backups'), getSettings(db).backups_to_keep, stamp) } catch (e) { console.warn('backup failed', e) }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  win.on('ready-to-show', () => win.show())
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  bootstrapData()
  registerIpc({ getDb: () => db, getDbPath: () => dbPath, setDataFolder })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => { try { if (lockAcquiredByUs) releaseLock(dataFolder); if (db) closeDatabase(db) } catch {} })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
