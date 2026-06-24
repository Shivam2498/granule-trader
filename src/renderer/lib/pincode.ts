import { isPincode } from '@shared/validation'
import { lookup } from 'india-pincode-lookup'

// Converts UPPER_CASE string to Title Case
function title(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim()
}

// Normalization map: package's (title-cased) state name → INDIAN_STATES entry
// Required because the package uses older/alternate names and & instead of "and"
const STATE_NORM: Record<string, string> = {
  'Andaman & Nicobar Islands': 'Andaman and Nicobar Islands',
  'Jammu & Kashmir': 'Jammu and Kashmir',
  // Dadra & Nagar Haveli and Daman & Diu were merged into one UT in 2020
  'Dadra & Nagar Haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'Daman & Diu': 'Dadra and Nagar Haveli and Daman and Diu',
  // Pondicherry was officially renamed to Puducherry
  'Pondicherry': 'Puducherry',
}

export function lookupPincode(pincode: string): { city: string; state: string } | null {
  if (!isPincode(pincode)) return null
  const records = lookup(pincode)
  if (!records || records.length === 0) return null
  const rec = records[0]
  const rawState = rec.stateName ?? ''
  const rawCity = rec.districtName ?? rec.taluk ?? rec.officeName ?? ''
  if (!rawState) return null
  const titledState = title(rawState)
  const state = STATE_NORM[titledState] ?? titledState
  return { city: title(rawCity), state }
}
