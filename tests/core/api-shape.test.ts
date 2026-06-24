import { describe, it, expect } from 'vitest'
import { CHANNELS } from '../../src/shared/api'

const API_METHODS = [
  'needsSetup','chooseDataFolder','getSettings','saveSettings','backupNow',
  'nextPurchaseCode','createPurchase','updatePurchase','listPurchases','deletePurchase',
  'nextInvoiceNumber','listAvailableLots','createSale','fillReservedSale','listSales',
  'getSaleWithAllocations','deleteSale','stockLedger','createStockAdjustment',
  'listCustomers','createCustomer','updateCustomer','deleteCustomer','listHsn','upsertHsn'
]

describe('ipc channels', () => {
  it('registers a channel for every Api method', () => {
    for (const m of API_METHODS) expect(CHANNELS).toContain(m)
  })
})
