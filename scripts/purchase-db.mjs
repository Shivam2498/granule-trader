// DB operations for the purchase import. Receives a better-sqlite3 handle;
// never imports the driver, so it is unit-testable against an in-memory DB.

export function ensureDescriptionColumn(db) {
  const cols = db.prepare('PRAGMA table_info(purchases)').all()
  if (!cols.some(c => c.name === 'description'))
    db.exec(`ALTER TABLE purchases ADD COLUMN description TEXT NOT NULL DEFAULT ''`)
}

// Read-only classification: which rows are new, which are duplicates, which suppliers are new.
export function planImport(db, toImport) {
  const dupStmt = db.prepare('SELECT id FROM purchases WHERE fy_label = ? AND code_seq = ?')
  const supStmt = db.prepare('SELECT id FROM suppliers WHERE lower(trim(name)) = lower(trim(?))')
  const toInsert = [], duplicates = [], newSuppliers = new Set(), seenKeys = new Set()
  for (const r of toImport) {
    const key = `${r.fy_label}#${r.code_seq}`
    if (dupStmt.get(r.fy_label, r.code_seq) || seenKeys.has(key)) { duplicates.push(r); continue }
    seenKeys.add(key)
    toInsert.push(r)
    if (!supStmt.get(r.party) && !newSuppliers.has(r.party.trim().toLowerCase()))
      newSuppliers.add(r.party.trim().toLowerCase())
  }
  // Preserve first-seen original-case names for the report.
  const names = []
  const seenName = new Set()
  for (const r of toInsert) {
    const k = r.party.trim().toLowerCase()
    if (newSuppliers.has(k) && !seenName.has(k) && !supStmt.get(r.party)) { seenName.add(k); names.push(r.party.trim()) }
  }
  return { toInsert, duplicates, suppliersToCreate: names }
}

// Idempotency relies on planImport() having just classified duplicates against the
// current DB state (single-writer, app closed); there is no DB-level UNIQUE(fy_label, code_seq).
// Writes everything in one transaction. Returns counts.
export function commitImport(db, toInsert) {
  ensureDescriptionColumn(db)
  const findSup = db.prepare('SELECT id FROM suppliers WHERE lower(trim(name)) = lower(trim(?))')
  const insSup = db.prepare('INSERT INTO suppliers (name) VALUES (?)')
  const ensureHsn = db.prepare(`INSERT OR IGNORE INTO hsn_products (hsn_code, description, gst_rate) VALUES (?, '', ?)`)
  const insPurchase = db.prepare(`INSERT INTO purchases
    (our_code, supplier_invoice_number, invoice_date, party, party_state, hsn_code, description,
     party_city, party_pincode, party_address, qty_kg, qty_remaining_kg, rate_per_kg, amount,
     cgst, sgst, igst, tcs, roundoff, total_invoice_amount, payment_status, payment_date,
     fy_label, code_seq, supplier_id)
    VALUES (@our_code, @supplier_invoice_number, @invoice_date, @party, '', @hsn_code, @description,
     '', '', '', @qty_kg, @qty_kg, @rate_per_kg, @amount,
     @cgst, @sgst, @igst, @tcs, @roundoff, @total_invoice_amount, 'done', NULL,
     @fy_label, @code_seq, @supplier_id)`)

  let inserted = 0, suppliersCreated = 0
  const run = db.transaction((rows) => {
    for (const r of rows) {
      let sup = findSup.get(r.party)
      if (!sup) { const info = insSup.run(r.party.trim()); sup = { id: Number(info.lastInsertRowid) }; suppliersCreated++ }
      ensureHsn.run(r.hsn_code, r.gst_rate)
      // Bind only the columns the statement declares (r also carries `line` and `gst_rate`,
      // which are not bind parameters).
      insPurchase.run({
        our_code: r.our_code, supplier_invoice_number: r.supplier_invoice_number, invoice_date: r.invoice_date,
        party: r.party, hsn_code: r.hsn_code, description: r.description, qty_kg: r.qty_kg,
        rate_per_kg: r.rate_per_kg, amount: r.amount, cgst: r.cgst, sgst: r.sgst, igst: r.igst, tcs: r.tcs,
        roundoff: r.roundoff, total_invoice_amount: r.total_invoice_amount, fy_label: r.fy_label,
        code_seq: r.code_seq, supplier_id: sup.id,
      })
      inserted++
    }
  })
  run(toInsert)
  return { inserted, suppliersCreated }
}
