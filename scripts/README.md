# One-time Excel migration

This script imports historical data **once** into a Granule Trader `.db` file.
It runs locally on the owner's machine and is not bundled into the app.

1. `npm i -D xlsx ts-node`
2. Close Granule Trader (release the data lock).
3. `node --loader ts-node/esm scripts/migrate-excel.ts /path/to/granule-trader.db /path/to/old-data.xlsx`

The column mapping is implemented once a sample workbook (with dummy data) is supplied.
All data stays on the local machine; no business data is shared elsewhere.
