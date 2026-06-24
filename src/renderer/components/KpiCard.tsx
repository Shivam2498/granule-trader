export default function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel" style={{ flex: 1, minWidth: 200 }}>
      <div style={{ color: 'var(--muted)', fontSize: 15 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  )
}
