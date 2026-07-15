# One-time Excel migration

This script imports historical data **once** into a Granule Trader `.db` file.
It runs locally on the owner's machine and is not bundled into the app.

1. `npm i -D xlsx ts-node`
2. Close Granule Trader (release the data lock).
3. `node --loader ts-node/esm scripts/migrate-excel.ts /path/to/granule-trader.db /path/to/old-data.xlsx`

The column mapping is implemented once a sample workbook (with dummy data) is supplied.
All data stays on the local machine; no business data is shared elsewhere.

## Purchase import

Imports historical purchases from a CSV export (one row per invoice) into a
Granule Trader `.db`. Dry-run by default — review the report files, then commit.

1. Quit Granule Trader (release the data lock).
2. `npm run rebuild:node`
3. Export the purchase tab to CSV. Dates must be `M/D/YYYY`; amounts may have commas.
4. Dry-run: `node scripts/import-purchases.mjs <granule-trader.db> <purchases.csv>`
   - Writes `<name>-import-<stamp>.log` and `<name>-import-skipped-<stamp>.csv` next to the CSV.
   - Skips rows with a bad date, non-positive qty, blank code/party/HSN, or a
     code-year that disagrees with the date-year — fix those in the skipped CSV and re-export.
5. Commit: add `--commit`. Idempotent — re-running skips lots already imported
   (matched by financial year + code sequence).

Tax figures (CGST/SGST/IGST/TCS/round-off/total) are imported verbatim from the
sheet. Suppliers are created by name only; fill in their details later in Suppliers.

## Sales migration (FY2026-27, one-time)

Imports the FY2026-27 sale invoices from `DataMigration.xlsx`, drawing each sale from the exact
lots recorded in the Stock sheet.

1. Export the Stock, SaleInvoiceMaster and CustomerMaster tabs as CSVs into one folder. The Stock sheet's Invoice Number column (col B) must carry each Sales row's RP number — both financial years.
2. Quit Granule Trader (release the data lock).
3. `npm run rebuild:node`
4. Dry-run against a copy:
   `MIGRATE_DIR=<folder with Stock.csv, SaleInvoiceMaster.csv, CustomerMaster.csv> MIGRATE_DB=<copy.db> npx vitest run tests/migrate/run-sales.test.ts`
   Fix any FAIL lines in the sheet, re-run until `failed 0`. FY2025-26 rows become opening-stock
   adjustments dated 2026-03-31; an invoice with no stock rows is left as a reserved blank bill.
5. Commit-run against the copy and confirm `all lots reconcile exactly`:
   add `MIGRATE_COMMIT=1`.
6. Only then repeat step 5 against the real `granule-trader.db` (back it up first). Idempotent —
   re-running skips invoices already imported.

The dry run validates parsing, buyers and lots (and warns on out-of-order dates); stock availability and invoice-ordering are fully enforced only on the commit run.
