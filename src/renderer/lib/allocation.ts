export interface UiLine { purchase_id: number; qty_drawn_kg: number; rate_per_kg: number }
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export function allocationSummary(lines: UiLine[]): { totalQty: number; amount: number } {
  let totalQty = 0, amount = 0
  for (const l of lines) { totalQty = r2(totalQty + l.qty_drawn_kg); amount = r2(amount + r2(l.qty_drawn_kg * l.rate_per_kg)) }
  return { totalQty, amount }
}
