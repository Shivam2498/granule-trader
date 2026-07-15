import type Database from 'better-sqlite3'
import type { Customer } from '@shared/types'
import { panFromGstin } from '@shared/validation'
import { createCustomer, placeOfSupplyState } from './customers'
import type { NewSale, NewSaleLine } from './sale'

// Excel's 1900 date system: serial 25569 is 1970-01-01, and that offset already absorbs Excel's
// fictitious 1900-02-29, so plain (serial - 25569) days is correct for every date we handle.
export function excelSerialToISO(serial: number | string): string {
  const n = typeof serial === 'string' ? Number(serial) : serial
  const ms = (n - 25569) * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}
