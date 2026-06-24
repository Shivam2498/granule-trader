import type { ReactNode } from 'react'
export default function PageHeader({ title, action, back }: { title: string; action?: ReactNode; back?: () => void }) {
  return (
    <div className="page-head">
      <div className="left">
        {back && <button className="link" onClick={back}>‹ Back</button>}
        <h1>{title}</h1>
      </div>
      {action}
    </div>
  )
}
