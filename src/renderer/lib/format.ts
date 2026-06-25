export function formatINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
export function today(): string {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export function formatAddress(p: { address?: string; city?: string; state?: string; pincode?: string }): string {
  const line = [p.address, p.city, p.state].filter(Boolean).join(', ')
  return p.pincode ? (line ? `${line} — ${p.pincode}` : p.pincode) : line
}
