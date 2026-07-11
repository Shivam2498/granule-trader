import type { Purchase, Customer, Supplier, Sale, SaleAllocation, HsnProduct, Settings, AvailableLot, LedgerRow } from './types'
import type { NewPurchase } from '../main/core/purchase'   // type-only import; not bundled into renderer
import type { NewSale } from '../main/core/sale'
import type { AdjustmentRow } from '../main/core/adjustment'
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
  listPurchases(fyLabel?: string): Promise<Purchase[]>
  deletePurchase(id: number): Promise<void>
  // sales
  nextInvoiceNumber(date: string, prefix: string): Promise<string>
  listAvailableLots(asOfDate: string, excludeSaleId?: number): Promise<AvailableLot[]>
  createSale(input: NewSale): Promise<Sale>
  fillReservedSale(id: number, input: NewSale): Promise<Sale>
  listSales(fyLabel?: string): Promise<Sale[]>
  getSaleWithAllocations(id: number): Promise<{ sale: Sale; allocations: SaleAllocation[] }>
  deleteSale(id: number): Promise<void>
  // stock
  stockLedger(): Promise<LedgerRow[]>
  createStockAdjustment(input: { purchase_id: number; qty_kg: number; reason: string; date: string }): Promise<void>
  listAdjustments(): Promise<AdjustmentRow[]>
  deleteAdjustment(id: number): Promise<void>
  // customers
  listCustomers(search?: string): Promise<Customer[]>
  createCustomer(c: Omit<Customer, 'id'>): Promise<Customer>
  updateCustomer(id: number, c: Omit<Customer, 'id'>): Promise<Customer>
  deleteCustomer(id: number): Promise<void>
  // suppliers
  listSuppliers(search?: string): Promise<Supplier[]>
  createSupplier(s: Omit<Supplier, 'id'>): Promise<Supplier>
  updateSupplier(id: number, s: Omit<Supplier, 'id'>): Promise<Supplier>
  deleteSupplier(id: number): Promise<void>
  // hsn
  listHsn(): Promise<HsnProduct[]>
  upsertHsn(h: HsnProduct): Promise<void>
  deleteHsn(code: string): Promise<void>
  // financial years
  listFinancialYears(): Promise<string[]>
  // export
  exportCsv(suggestedName: string, content: string): Promise<{ saved: boolean; path?: string }>
}
declare global { interface Window { api: Api } }

export const CHANNELS = [
  'needsSetup','chooseDataFolder','getSettings','saveSettings','backupNow','exportCsv',
  'nextPurchaseCode','createPurchase','updatePurchase','listPurchases','deletePurchase',
  'nextInvoiceNumber','listAvailableLots','createSale','fillReservedSale','listSales',
  'getSaleWithAllocations','deleteSale','stockLedger','createStockAdjustment','listAdjustments','deleteAdjustment',
  'listCustomers','createCustomer','updateCustomer','deleteCustomer','listSuppliers','createSupplier','updateSupplier','deleteSupplier','listHsn','upsertHsn','deleteHsn','listFinancialYears'
] as const
