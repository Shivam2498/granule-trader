import { NavLink } from 'react-router-dom'
const items = [
  ['/', 'Dashboard'], ['/purchases', 'Purchases'], ['/sales', 'Sales'],
  ['/stock', 'Stock'], ['/customers', 'Customers'], ['/settings', 'Settings']
] as const
export default function Sidebar() {
  return (
    <nav className="sidebar">
      <h2 style={{ marginTop: 0 }}>Granule Trader</h2>
      {items.map(([to, label]) => (
        <NavLink key={to} to={to} end={to === '/'}
          className={({ isActive }) => isActive ? 'active' : ''}>{label}</NavLink>
      ))}
    </nav>
  )
}
