import { NavLink as RouterNavLink, useLocation } from 'react-router-dom'
import { NavLink, Title, Stack } from '@mantine/core'
import { IconDashboard, IconShoppingCart, IconReceipt, IconBox, IconUsers, IconBuildingWarehouse, IconSettings } from '@tabler/icons-react'

const items = [
  { to: '/', label: 'Dashboard', icon: IconDashboard },
  { to: '/purchases', label: 'Purchases', icon: IconShoppingCart },
  { to: '/sales', label: 'Sales', icon: IconReceipt },
  { to: '/stock', label: 'Stock', icon: IconBox },
  { to: '/customers', label: 'Customers', icon: IconUsers },
  { to: '/suppliers', label: 'Suppliers', icon: IconBuildingWarehouse },
  { to: '/settings', label: 'Settings', icon: IconSettings }
]

export default function Sidebar() {
  const loc = useLocation()
  return (
    <Stack gap="xs">
      <Title order={3} mb="sm">Granule Trader</Title>
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} component={RouterNavLink} to={to} label={label}
          leftSection={<Icon size={20} />}
          active={to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to)} />
      ))}
    </Stack>
  )
}
