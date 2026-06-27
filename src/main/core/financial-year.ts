import type Database from 'better-sqlite3'

export function listFinancialYears(db: Database.Database): string[] {
  return (db.prepare(`
    SELECT DISTINCT fy_label FROM
      (SELECT fy_label FROM purchases UNION SELECT fy_label FROM sales)
    ORDER BY fy_label DESC
  `).all() as Array<{ fy_label: string }>).map(r => r.fy_label)
}

export function financialYear(date: string): { startYear: number; endYear: number; code: string; label: string } {
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) throw new Error('Invalid date: ' + date)
  const [yStr, mStr] = date.split('-')
  const year = Number(yStr)
  const month = Number(mStr)
  const startYear = month >= 4 ? year : year - 1
  const endYear = startYear + 1
  const code = `${String(startYear).slice(2)}${String(endYear).slice(2)}`
  const label = `${startYear}-${String(endYear).slice(2)}`
  return { startYear, endYear, code, label }
}
