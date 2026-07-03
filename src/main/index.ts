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

// Try to take the per-folder lock, prompting the user when it is genuinely held elsewhere.
// Returns true if we now hold the lock, false if the user chose not to reclaim it.
// A stale lock (same machine, dead PID) is reclaimed silently.
function acquireLockInteractive(folder: string, cancelLabel: string): boolean {
  const lock = acquireLock(folder, hostname())
  if (lock.ok) return true
  const holder = (lock.existingHolder ?? '').trim()
  const sameMachine = holder === hostname()
  const holderPid = lock.existingPid ?? null
  const liveElsewhere = sameMachine ? (holderPid !== null && pidAlive(holderPid)) : true
  if (!liveElsewhere) {
    // Same machine but the locking process is gone — stale crash lock; reclaim silently.
    releaseLock(folder); acquireLock(folder, hostname())
    return true
  }
  const message = sameMachine
    ? `This data is already open on this machine (PID ${holderPid}).`
    : `This data is currently open on ${holder}.`
  const choice = dialog.showMessageBoxSync({
    type: 'warning',
    buttons: [cancelLabel, 'Open anyway'],
    defaultId: 0, cancelId: 0,
    title: 'Data may be open elsewhere',
    message,
    detail: 'Open anyway only if you are sure the other instance is closed. Opening it twice at once can corrupt the file.'
  })
  if (choice === 0) return false
  releaseLock(folder); acquireLock(folder, hostname())
  return true
}

// Switch the active data folder and persist the pointer in the bootstrap (userData)
// DB, so the next launch reopens here instead of falling back to onboarding.
// The switch is atomic: we open the new database and take its lock BEFORE releasing
// the old one, so a bad target folder leaves the app running on the current data.
function setDataFolder(folder: string): void {
  const newPath = dbPathFor(folder)
  let newDb: Database.Database
  try {
    newDb = openDatabase(newPath)
  } catch (e) {
    throw new Error(`Couldn't open the selected data folder. It may be read-only or unavailable. (${(e as Error).message})`)
  }
  // Take the new folder's lock, warning if it's open elsewhere — same guard as first launch.
  let acquired: boolean
  try {
    acquired = acquireLockInteractive(folder, 'Cancel')
  } catch (e) {
    closeDatabase(newDb)
    throw e
  }
  if (!acquired) {
    closeDatabase(newDb)
    throw new Error('Switch cancelled — that data is open elsewhere.')
  }
  // Commit: only now do we let go of the old folder and swap in the new connection.
  if (lockAcquiredByUs) releaseLock(dataFolder)
  if (db) closeDatabase(db)
  db = newDb
  dataFolder = folder
  dbPath = newPath
  lockAcquiredByUs = true
  rememberDataFolder(app.getPath('userData'), folder)
}

function bootstrapData(): void {
  // First launch with no chosen folder: use userData until the user picks one in Settings/FirstRun.
  // resolveDataFolder reads the data_folder pointer recorded in the userData DB.
  openIn(resolveDataFolder(app.getPath('userData')))
  // A DIFFERENT machine, or the same machine with a live PID, holding the lock is a genuine
  // "open elsewhere" — warn and quit unless the user insists. A stale crash lock is reclaimed silently.
  if (!acquireLockInteractive(dataFolder, 'Quit')) { app.quit(); return }
  lockAcquiredByUs = true
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
