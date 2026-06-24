import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { hostname } from 'os'
import type Database from 'better-sqlite3'
import { openDatabase, closeDatabase } from './db/connection'
import { getSettings } from './core/reference'
import { createBackup, acquireLock, releaseLock } from './core/backup'
import { registerIpc } from './ipc'

let db: Database.Database
let dbPath: string
let dataFolder: string

function dbPathFor(folder: string): string { return join(folder, 'granule-trader.db') }

function openIn(folder: string): void {
  if (db) closeDatabase(db)
  dataFolder = folder
  dbPath = dbPathFor(folder)
  db = openDatabase(dbPath)
}

function bootstrapData(): void {
  // First launch with no chosen folder: use userData until the user picks one in Settings/FirstRun.
  openIn(app.getPath('userData'))
  const s = getSettings(db)
  if (s.data_folder && s.data_folder !== dataFolder) openIn(s.data_folder)
  const lock = acquireLock(dataFolder, hostname())
  if (!lock.ok) {
    const holder = (lock.existingHolder ?? '').trim()
    if (holder === hostname()) {
      // Lock belongs to THIS machine — a previous run crashed or was killed without
      // releasing it. The app is not actually open here, so reclaim it silently.
      releaseLock(dataFolder); acquireLock(dataFolder, hostname())
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
    }
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
  registerIpc({ getDb: () => db, getDbPath: () => dbPath, reopenWithFolder: openIn })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => { try { releaseLock(dataFolder); if (db) closeDatabase(db) } catch {} })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
