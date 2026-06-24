import type { ReactNode } from 'react'
export default function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="section">
      <h3>{title}</h3>
      <div className="divider" />
      <div className="form-grid">{children}</div>
    </div>
  )
}
