import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import {
  nextPurchaseCode, createPurchase, listPurchases, deletePurchase, updatePurchase, getPurchaseItems
} from '../../src/main/core/purchase'
import { mkPurchase, editPurchase } from '../helpers/purchase'
import { createSupplier } from '../../src/main/core/suppliers'
import { listAvailableLots } from '../../src/main/core/available-lots'
import { createSale } from '../../src/main/core/sale'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })

const base = {
  supplier_invoice_number: 'S-1', party: 'Acme', party_state: 'Gujarat',
  hsn_code: '3902', qty_kg: 1000, amount: 50000, gst_rate: 18, homeState: 'Gujarat'
}

describe('nextPurchaseCode', () => {
  it('starts at 0001 for an empty FY', () => {
    expect(nextPurchaseCode(db, '2024-05-01')).toBe('0001/2425')
  })
  it('increments within the FY and resets next FY', () => {
    mkPurchase(db, { ...base, our_code: nextPurchaseCode(db, '2024-05-01'), invoice_date: '2024-05-01' })
    expect(nextPurchaseCode(db, '2024-06-01')).toBe('0002/2425')
    expect(nextPurchaseCode(db, '2025-04-02')).toBe('0001/2526')
  })
})

describe('createPurchase', () => {
  it('sets remaining = qty and computes intra-state tax', () => {
    const p = mkPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01' })
    expect(p.qty_remaining_kg).toBe(1000)
    expect(p.cgst).toBe(4500)
    expect(p.sgst).toBe(4500)
    expect(p.total_invoice_amount).toBe(59000)
  })

  it('reflects a manual IGST override in the stored total', () => {
    // Inter-state, amount 1000 @ 18% -> auto IGST 180, total 1180.
    // Override IGST to 200 -> total must be 1200, not 1180.
    const p = mkPurchase(db, {
      ...base, our_code: '0001/2425', invoice_date: '2024-05-01',
      qty_kg: 100, amount: 1000, party_state: 'Maharashtra', igst_manual: 200
    })
    expect(p.igst).toBe(200)
    expect(p.total_invoice_amount).toBe(1200)
  })

  it('stores a per-purchase description', () => {
    const p = mkPurchase(db, { ...base, our_code: '0007/2425', invoice_date: '2024-05-01', description: 'Black M/B' })
    expect(p.description).toBe('Black M/B')
    const updated = editPurchase(db, p.id, { ...base, our_code: '0007/2425', invoice_date: '2024-05-01', description: 'White M/B' })
    expect(updated.description).toBe('White M/B')
  })
})

describe('deletePurchase', () => {
  it('lists then deletes a purchase with no allocations', () => {
    const p = mkPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01' })
    expect(listPurchases(db)).toHaveLength(1)
    deletePurchase(db, p.id)
    expect(listPurchases(db)).toHaveLength(0)
  })
  it('blocks deletion when allocations reference the lot', () => {
    const p = mkPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01' })
    const info = db.prepare(`INSERT INTO sales (invoice_number, prefix, seq, fy_label, status, invoice_date)
      VALUES ('RP/001/2024-25','RP',1,'2024-25','created','2024-05-10')`).run()
    db.prepare(`INSERT INTO sale_allocations (sale_id, purchase_id, qty_drawn_kg, rate_per_kg, line_amount)
      VALUES (?, ?, 100, 80, 8000)`).run(info.lastInsertRowid, p.id)
    expect(() => deletePurchase(db, p.id)).toThrow(/used in one or more sales/)
    expect(listPurchases(db)).toHaveLength(1)
  })
})

describe('updatePurchase', () => {
  it('rejects qty below already-drawn', () => {
    const p = mkPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01' })
    // 600 kg already drawn out of the lot (the lot lives on purchase_items now)
    db.prepare('UPDATE purchase_items SET qty_remaining_kg = 400 WHERE purchase_id = ?').run(p.id)
    expect(() => editPurchase(db, p.id, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 500 }))
      .toThrow(/already sold 600/)
  })
})

describe('rate-driven amount', () => {
  it('derives amount from quantity x rate and stores rate + address', () => {
    const p = mkPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01',
      qty_kg: 1000, rate_per_kg: 50, party_city: 'Surat', party_pincode: '395003', party_address: 'GIDC' })
    expect(p.amount).toBe(50000)            // 1000 * 50
    expect(p.rate_per_kg).toBe(50)
    expect(p.party_city).toBe('Surat')
    expect(p.cgst).toBe(4500)               // 9% of 50000 intra-state
    expect(p.total_invoice_amount).toBe(59000)
  })
})

describe('purchase supplier link', () => {
  it('stores and returns supplier_id', () => {
    const sup = createSupplier(db, {
      name: 'Acme Polymers', gstin: '24CCGPC8555A1Z5', pan: 'CCGPC8555A', phone: '9876543210',
      address: '1 Estate', city: 'Surat', state: 'Gujarat', pincode: '395003'
    })
    const p = mkPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01', supplier_id: sup.id })
    expect(p.supplier_id).toBe(sup.id)
    expect(listPurchases(db)[0].supplier_id).toBe(sup.id)
  })
  it('defaults supplier_id to null when omitted', () => {
    const p = mkPurchase(db, { ...base, our_code: '0002/2425', invoice_date: '2024-05-01' })
    expect(p.supplier_id).toBeNull()
  })
})

describe('duplicate purchase code', () => {
  it('rejects a second purchase with the same code in the same FY', () => {
    mkPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01' })
    expect(() => mkPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-06-01' }))
      .toThrow(/already exists/)
  })
  it('updatePurchase rejects colliding with another code but allows keeping its own', () => {
    const a = mkPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01' })
    const b = mkPurchase(db, { ...base, our_code: '0002/2425', invoice_date: '2024-05-02' })
    expect(() => editPurchase(db, b.id, { ...base, our_code: '0001/2425', invoice_date: '2024-05-02', qty_kg: 1000 }))
      .toThrow(/already exists/)
    expect(() => editPurchase(db, a.id, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 1000 })).not.toThrow()
  })
})

describe('listPurchases FY filter', () => {
  it('filters by fy_label and returns all when omitted', () => {
    mkPurchase(db, { ...base, our_code: nextPurchaseCode(db, '2024-05-01'), invoice_date: '2024-05-01' })
    mkPurchase(db, { ...base, our_code: nextPurchaseCode(db, '2025-06-01'), invoice_date: '2025-06-01' })
    expect(listPurchases(db)).toHaveLength(2)
    expect(listPurchases(db, '2024-25')).toHaveLength(1)
    expect(listPurchases(db, '2024-25')[0].fy_label).toBe('2024-25')
    expect(listPurchases(db, '2099-00')).toHaveLength(0)
  })
})

describe('multi-HSN purchases', () => {
  const multi = {
    our_code: '0001/2425', invoice_date: '2024-05-01', supplier_invoice_number: 'S-1',
    party: 'Reliance', party_state: 'Gujarat', homeState: 'Gujarat',
    items: [
      { hsn_code: '39021000', description: 'PP', qty_kg: 5000, rate_per_kg: 80, gst_rate: 18 },
      { hsn_code: '39012000', description: 'HDPE', qty_kg: 2000, rate_per_kg: 90, gst_rate: 18 },
      { hsn_code: '320419', description: 'Masterbatch', qty_kg: 500, rate_per_kg: 200, gst_rate: 5 }
    ]
  }

  it('creates one stock lot per line', () => {
    const p = createPurchase(db, multi)
    const items = getPurchaseItems(db, p.id)
    expect(items).toHaveLength(3)
    expect(items.map(i => i.hsn_code)).toEqual(['39021000', '39012000', '320419'])
    expect(items.map(i => i.line_no)).toEqual([1, 2, 3])
    // each lot starts full
    expect(items.map(i => i.qty_remaining_kg)).toEqual([5000, 2000, 500])
    expect(items.map(i => i.amount)).toEqual([400000, 180000, 100000])
  })

  it('taxes each line at its own GST rate, not one blended rate', () => {
    const p = createPurchase(db, multi)
    // taxable: 400000 + 180000 + 100000 = 680000
    expect(p.amount).toBe(680000)
    // 18% on 580000 = 104400 → 52200 each side; 5% on 100000 = 5000 → 2500 each side
    expect(p.cgst).toBe(54700)   // 52200 + 2500
    expect(p.sgst).toBe(54700)
    expect(p.igst).toBe(0)
    expect(p.total_invoice_amount).toBe(789400)
  })

  it('charges IGST across all lines when the supplier is out of state', () => {
    const p = createPurchase(db, { ...multi, party_state: 'Maharashtra' })
    expect(p.cgst).toBe(0)
    expect(p.sgst).toBe(0)
    expect(p.igst).toBe(109400)   // 18% of 580000 + 5% of 100000
  })

  it('every line becomes a sellable lot of its own', () => {
    const p = createPurchase(db, multi)
    const lots = listAvailableLots(db, '2024-06-01')
    expect(lots).toHaveLength(3)
    expect(lots.map(l => l.our_code)).toEqual(['0001/2425-1', '0001/2425-2', '0001/2425-3'])
    expect(lots.map(l => l.available_kg)).toEqual([5000, 2000, 500])
  })

  it('names a single-line purchase without a line suffix', () => {
    createPurchase(db, { ...multi, our_code: '0002/2425', items: [multi.items[0]] })
    const lot = listAvailableLots(db, '2024-06-01').find(l => l.purchase_id === 1 || l.our_code.startsWith('0002'))!
    expect(lot.our_code).toBe('0002/2425')
  })

  it('refuses a purchase with no items', () => {
    expect(() => createPurchase(db, { ...multi, items: [] })).toThrow(/at least one item/)
  })

  it('adds, edits and removes lines on update', () => {
    const p = createPurchase(db, multi)
    const items = getPurchaseItems(db, p.id)
    const updated = updatePurchase(db, p.id, {
      ...multi,
      items: [
        { id: items[0].id, hsn_code: '39021000', qty_kg: 6000, rate_per_kg: 80, gst_rate: 18 },  // edited
        { hsn_code: '39023000', qty_kg: 1000, rate_per_kg: 70, gst_rate: 18 }                     // new; other two dropped
      ]
    })
    const after = getPurchaseItems(db, updated.id)
    expect(after).toHaveLength(2)
    expect(after.map(i => i.hsn_code)).toEqual(['39021000', '39023000'])
    expect(after[0].qty_kg).toBe(6000)
    expect(after[0].qty_remaining_kg).toBe(6000)
  })

  it('refuses to remove a line that has already been sold from', () => {
    const p = createPurchase(db, multi)
    const items = getPurchaseItems(db, p.id)
    createSale(db, {
      invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      buyer_customer_id: null, buyer_name: 'B', buyer_gstin: '', buyer_billing: {}, buyer_shipping: {},
      place_of_supply_state: 'Gujarat', homeState: 'Gujarat',
      lines: [{ purchase_item_id: items[1].id, qty_drawn_kg: 500, rate_per_kg: 100, hsn_code: '39012000', gst_rate: 18 }]
    })
    // line 2 (HDPE) has been sold from — dropping it would orphan that sale's stock
    expect(() => updatePurchase(db, p.id, { ...multi, items: [{ id: items[0].id, ...multi.items[0] }] }))
      .toThrow(/already been sold/)
  })

  it('keeps the sold quantity when a line is resized', () => {
    const p = createPurchase(db, multi)
    const items = getPurchaseItems(db, p.id)
    createSale(db, {
      invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      buyer_customer_id: null, buyer_name: 'B', buyer_gstin: '', buyer_billing: {}, buyer_shipping: {},
      place_of_supply_state: 'Gujarat', homeState: 'Gujarat',
      lines: [{ purchase_item_id: items[0].id, qty_drawn_kg: 1000, rate_per_kg: 100, hsn_code: '39021000', gst_rate: 18 }]
    })
    // 5000 bought, 1000 sold → 4000 left. Resize to 4500 → 3500 left, sold quantity untouched.
    updatePurchase(db, p.id, {
      ...multi,
      items: [
        { id: items[0].id, hsn_code: '39021000', qty_kg: 4500, rate_per_kg: 80, gst_rate: 18 },
        { id: items[1].id, ...multi.items[1] },
        { id: items[2].id, ...multi.items[2] }
      ]
    })
    expect(getPurchaseItems(db, p.id)[0].qty_remaining_kg).toBe(3500)
  })

  it('refuses to shrink a line below what has already been sold', () => {
    const p = createPurchase(db, multi)
    const items = getPurchaseItems(db, p.id)
    createSale(db, {
      invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      buyer_customer_id: null, buyer_name: 'B', buyer_gstin: '', buyer_billing: {}, buyer_shipping: {},
      place_of_supply_state: 'Gujarat', homeState: 'Gujarat',
      lines: [{ purchase_item_id: items[0].id, qty_drawn_kg: 1000, rate_per_kg: 100, hsn_code: '39021000', gst_rate: 18 }]
    })
    expect(() => updatePurchase(db, p.id, {
      ...multi,
      items: [
        { id: items[0].id, hsn_code: '39021000', qty_kg: 800, rate_per_kg: 80, gst_rate: 18 },
        { id: items[1].id, ...multi.items[1] },
        { id: items[2].id, ...multi.items[2] }
      ]
    })).toThrow(/already sold 1000 kg/)
  })
})
