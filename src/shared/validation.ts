export function isGstin(s: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s.trim())
}
export function isPan(s: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s.trim())
}

export function panFromGstin(gstin: string): string {
  const g = gstin.trim().toUpperCase()
  return g.length >= 12 ? g.slice(2, 12) : ''
}
export function isMobile(s: string): boolean {
  return /^[0-9]{10}$/.test(s.trim())
}
export function isPincode(s: string): boolean {
  return /^[0-9]{6}$/.test(s.trim())
}
export function isEmail(s: string): boolean {
  // Deliberately loose: something@something.tld, no spaces. Catches typos, not RFC edge cases.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

export const VMSG = {
  gstin: 'Enter a valid GSTIN, like 24ABCDE1234F1Z5.',
  phone: 'Enter a 10-digit phone number.',
  pincode: 'Enter a 6-digit pincode.',
  email: 'Enter a valid email, like name@company.com.'
} as const

const PREFIX_SKIP = new Set(['and', 'the', 'of', '&'])

export function deriveInvoicePrefix(name: string): string {
  const words = name.trim().split(/\s+/).filter(w => w && !PREFIX_SKIP.has(w.toLowerCase()))
  if (words.length === 0) return ''
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return words.map(w => w[0].toUpperCase()).join('')
}
