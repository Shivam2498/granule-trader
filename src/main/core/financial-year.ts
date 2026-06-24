export function financialYear(date: string): { startYear: number; endYear: number; code: string; label: string } {
  const [yStr, mStr] = date.split('-')
  const year = Number(yStr)
  const month = Number(mStr)
  const startYear = month >= 4 ? year : year - 1
  const endYear = startYear + 1
  const code = `${String(startYear).slice(2)}${String(endYear).slice(2)}`
  const label = `${startYear}-${String(endYear).slice(2)}`
  return { startYear, endYear, code, label }
}
