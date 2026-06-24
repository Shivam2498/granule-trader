import type { ReactNode } from 'react'
import PageHeader from './PageHeader'
export default function FormPage({ title, onBack, error, footer, children }:
  { title: string; onBack: () => void; error?: string; footer: ReactNode; children: ReactNode }) {
  return (
    <div>
      <PageHeader title={title} back={onBack} />
      {error && <div className="error-banner">{error}</div>}
      <div className="card">{children}</div>
      <div className="form-actions">{footer}</div>
    </div>
  )
}
