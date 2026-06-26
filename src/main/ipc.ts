import { ipcMain, dialog } from 'electron'
import type Database from 'better-sqlite3'
import { getSettings, saveSettings } from './core/reference'
import { nextPurchaseCode, createPurchase, updatePurchase, listPurchases, deletePurchase } from './core/purchase'
import { nextInvoiceNumber } from './core/invoice-number'
import { listAvailableLots } from './core/available-lots'
import { createSale, fillReservedSale, listSales, getSale, getAllocations, deleteSale } from './core/sale'
import { stockLedger, createStockAdjustment, listAdjustments, deleteAdjustment } from './core/adjustment'
import { listCustomers, createCustomer, updateCustomer, deleteCustomer } from './core/customers'
import { listSuppliers, createSupplier, updateSupplier, deleteSupplier } from './core/suppliers'
import { listHsn, upsertHsn } from './core/reference'
import { createBackup } from './core/backup'
import { listFinancialYears } from './core/financial-year'
import { join, dirname } from 'path'
import { writeFileSync } from 'fs'

// CHANNELS lives in src/shared/api.ts (single source of truth, also imported by preload + the guard test).

export interface IpcContext {
  getDb(): Database.Database
  getDbPath(): string
  setDataFolder(folder: string): void
}

export function registerIpc(ctx: IpcContext): void {
  const h = (name: string, fn: (...a: any[]) => any) => ipcMain.handle(name, (_e, ...args) => fn(...args))
  const db = () => ctx.getDb()

  h('needsSetup', () => !getSettings(db()).home_state)
  h('chooseDataFolder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    ctx.setDataFolder(r.filePaths[0])
    return r.filePaths[0]
  })
  h('getSettings', () => getSettings(db()))
  h('saveSettings', (p) => saveSettings(db(), p))
  h('backupNow', () => {
    const s = getSettings(db())
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = join(dirname(ctx.getDbPath()), 'backups')
    return createBackup(ctx.getDbPath(), backupDir, s.backups_to_keep, stamp)
  })

  h('exportCsv', async (suggestedName: string, content: string) => {
    const r = await dialog.showSaveDialog({ defaultPath: suggestedName, filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (r.canceled || !r.filePath) return { saved: false }
    writeFileSync(r.filePath, content, 'utf8')
    return { saved: true, path: r.filePath }
  })

  h('nextPurchaseCode', (date) => nextPurchaseCode(db(), date))
  h('createPurchase', (input) => createPurchase(db(), input))
  h('updatePurchase', (id, input) => updatePurchase(db(), id, input))
  h('listPurchases', (fyLabel) => listPurchases(db(), fyLabel))
  h('deletePurchase', (id) => deletePurchase(db(), id))

  h('nextInvoiceNumber', (date, prefix) => nextInvoiceNumber(db(), date, prefix))
  h('listAvailableLots', (asOfDate, excludeSaleId) => listAvailableLots(db(), asOfDate, { excludeSaleId }))
  h('createSale', (input) => createSale(db(), input))
  h('fillReservedSale', (id, input) => fillReservedSale(db(), id, input))
  h('listSales', (fyLabel) => listSales(db(), fyLabel))
  h('getSaleWithAllocations', (id) => ({ sale: getSale(db(), id), allocations: getAllocations(db(), id) }))
  h('deleteSale', (id) => deleteSale(db(), id))

  h('stockLedger', () => stockLedger(db()))
  h('createStockAdjustment', (input) => createStockAdjustment(db(), input))
  h('listAdjustments', () => listAdjustments(db()))
  h('deleteAdjustment', (id) => deleteAdjustment(db(), id))

  h('listCustomers', (search) => listCustomers(db(), search))
  h('createCustomer', (c) => createCustomer(db(), c))
  h('updateCustomer', (id, c) => updateCustomer(db(), id, c))
  h('deleteCustomer', (id) => deleteCustomer(db(), id))

  h('listSuppliers', (search) => listSuppliers(db(), search))
  h('createSupplier', (s) => createSupplier(db(), s))
  h('updateSupplier', (id, s) => updateSupplier(db(), id, s))
  h('deleteSupplier', (id) => deleteSupplier(db(), id))

  h('listHsn', () => listHsn(db()))
  h('upsertHsn', (hh) => upsertHsn(db(), hh))

  h('listFinancialYears', () => listFinancialYears(db()))
}
