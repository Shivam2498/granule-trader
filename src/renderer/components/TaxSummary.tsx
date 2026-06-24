import React from 'react'
import { formatINR } from '../lib/format'

export default function TaxSummary({ taxable, rows, total }:
  { taxable: number; rows: { label: string; value: number }[]; total: number }) {
  return (
    <div className="tax-summary">
      <div className="label">Taxable</div><div className="val">{formatINR(taxable)}</div>
      {rows.map(r => (
        <React.Fragment key={r.label}>
          <div className="label">{r.label}</div>
          <div className="val">{formatINR(r.value)}</div>
        </React.Fragment>
      ))}
      <div className="label total">Net total</div><div className="val total">{formatINR(total)}</div>
    </div>
  )
}
