export interface MonthGroup<T> { key: string; items: T[] }

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Buckets by the YYYY-MM of getDate(item); null/empty date → key 'undated'.
// Order: 'undated' first (when present), then YYYY-MM keys descending.
// Input order is preserved within each group.
export function groupByMonth<T>(items: T[], getDate: (t: T) => string | null | undefined): MonthGroup<T>[] {
  const buckets = new Map<string, T[]>()
  for (const item of items) {
    const date = getDate(item)
    const key = date ? date.slice(0, 7) : 'undated'
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }
  const keys = [...buckets.keys()]
  const undated = keys.includes('undated') ? ['undated'] : []
  const months = keys.filter(k => k !== 'undated').sort().reverse()
  return [...undated, ...months].map(key => ({ key, items: buckets.get(key)! }))
}

// 'undated' → 'Undated'; 'YYYY-MM' → 'June 2026'.
export function monthLabel(key: string): string {
  if (key === 'undated') return 'Undated'
  const [year, month] = key.split('-')
  return `${MONTHS[Number(month) - 1]} ${year}`
}
