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
