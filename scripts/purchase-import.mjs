// Pure helpers for the one-time purchase CSV import (see import-purchases.mjs).
// Plain ESM so both the CLI and vitest import the same code. No DB access here.

// Sign-symmetric 2-decimal rounding — mirrors src/shared/money.ts round2.
export function round2(n) {
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100
}

// "51,000.00" -> 51000 ; "" -> 0 ; "-1.2" -> -1.2 ; "abc" -> NaN
export function cleanNumber(s) {
  const t = String(s ?? '').replace(/[,₹\s]/g, '').trim()
  if (t === '') return 0
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

// "M/D/YYYY" -> "YYYY-MM-DD" (or null if unparseable / not a real calendar date)
export function parseDateMDY(s) {
  const m = String(s ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const month = Number(m[1]), day = Number(m[2]), year = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const d = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) return null
  return iso
}

// Mirrors src/main/core/financial-year.ts financialYear() (code + label only).
export function fyFromDate(iso) {
  const [y, mm] = iso.split('-')
  const year = Number(y), month = Number(mm)
  const startYear = month >= 4 ? year : year - 1
  const endYear = startYear + 1
  return { code: `${String(startYear).slice(2)}${String(endYear).slice(2)}`, label: `${startYear}-${String(endYear).slice(2)}` }
}

// Mirrors src/main/core/purchase.ts parsePurchaseSeq().
export function seqFromCode(code) {
  const m = String(code ?? '').trim().match(/^(\d+)/)
  return m ? Number(m[1]) : 0
}

// The "/NNNN" financial-year token embedded in a code like "082/2526", or '' if absent.
export function fyCodeFromCode(code) {
  const m = String(code ?? '').trim().match(/\/(\d{4})(?:\D|$)/)
  return m ? m[1] : ''
}
