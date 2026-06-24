import type { Purchase, Customer, Sale, SaleAllocation, HsnProduct, Settings, AvailableLot, LedgerRow } from './types'
import type { NewPurchase } from '../main/core/purchase'   // type-only import; not bundled into renderer
import type { NewSale } from '../main/core/sale'
export interface Api {
  // bootstrap / settings
  needsSetup(): Promise<boolean>
  chooseDataFolder(): Promise<string | null>
  getSettings(): Promise<Settings>
  saveSettings(p: Partial<Settings>): Promise<Settings>
  backupNow(): Promise<string>
  // purchases
  nextPurchaseCode(date: string): Promise<string>
  createPurchase(input: NewPurchase): Promise<Purchase>
  updatePurchase(id: number, input: NewPurchase): Promise<Purchase>
  listPurchases(): Promise<Purchase[]>
  deletePurchase(id: number): Promise<void>
  // sales
  nextInvoiceNumber(date: string, prefix: string): Promise<string>
  listAvailableLots(asOfDate: string, excludeSaleId?: number): Promise<AvailableLot[]>
  createSale(input: NewSale): Promise<Sale>
  fillReservedSale(id: number, input: NewSale): Promise<Sale>
  listSales(): Promise<Sale[]>
  getSaleWithAllocations(id: number): Promise<{ sale: Sale; allocations: SaleAllocation[] }>
  deleteSale(id: number): Promise<void>
  // stock
  stockLedger(): Promise<LedgerRow[]>
  createStockAdjustment(input: { purchase_id: number; qty_kg: number; reason: string; date: string }): Promise<void>
  // customers
  listCustomers(search?: string): Promise<Customer[]>
  createCustomer(c: Omit<Customer, 'id'>): Promise<Customer>
  updateCustomer(id: number, c: Omit<Customer, 'id'>): Promise<Customer>
  deleteCustomer(id: number): Promise<void>
  // hsn
  listHsn(): Promise<HsnProduct[]>
  upsertHsn(h: HsnProduct): Promise<void>
}
declare global { interface Window { api: Api } }

export const CHANNELS = [
  'needsSetup','chooseDataFolder','getSettings','saveSettings','backupNow',
  'nextPurchaseCode','createPurchase','updatePurchase','listPurchases','deletePurchase',
  'nextInvoiceNumber','listAvailableLots','createSale','fillReservedSale','listSales',
  'getSaleWithAllocations','deleteSale','stockLedger','createStockAdjustment',
  'listCustomers','createCustomer','updateCustomer','deleteCustomer','listHsn','upsertHsn'
] as const
