import { useState } from 'react'
import { NumberInput } from '@mantine/core'

// Amount is a pure UI convenience (qty × rate) — never sent to the backend, and editable in the
// other direction: type an amount and the rate is derived from it on blur. Qty is the value the
// user set deliberately and is never touched here.
//
// While the user is typing, this component holds their in-progress text in its OWN state instead
// of the derived qty×rate value (so a typed-but-uncommitted amount doesn't get fought with by the
// qty×rate placeholder on every keystroke); on blur it either recalculates rate (qty > 0, rounded
// to 4 decimal places) or is simply discarded back to qty × rate.
export default function AmountInput({ qty, rate, onRateChange }: {
  qty: number
  rate: number
  onRateChange: (newRate: number) => void
}) {
  const [override, setOverride] = useState<number | undefined>(undefined)

  return (
    <NumberInput
      value={(override ?? qty * rate) || ''}
      min={0}
      decimalScale={2}
      step={1}
      hideControls
      allowNegative={false}
      thousandSeparator=","
      clampBehavior="strict"
      onChange={n => {
        const amt = typeof n === 'number' ? n : (n === '' ? 0 : Number(n))
        setOverride(amt)
      }}
      onBlur={() => {
        if (override === undefined) return
        // Rate can only be derived from amount when qty is known — otherwise leave it be.
        if (qty > 0) onRateChange(Math.round((override / qty) * 10000) / 10000)
        setOverride(undefined)
      }}
    />
  )
}
