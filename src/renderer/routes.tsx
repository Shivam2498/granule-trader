import { Routes, Route } from 'react-router-dom'
import Dashboard from './screens/Dashboard'
import Purchases from './screens/Purchases'
import PurchaseForm from './screens/PurchaseForm'
import Sales from './screens/Sales'
import NewSale from './screens/NewSale'
import Stock from './screens/Stock'
import StockAdjust from './screens/StockAdjust'
import Customers from './screens/Customers'
import CustomerForm from './screens/CustomerForm'
import Suppliers from './screens/Suppliers'
import SupplierForm from './screens/SupplierForm'
import Settings from './screens/Settings'
import InvoiceView from './screens/InvoiceView'
export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/purchases" element={<Purchases />} />
      <Route path="/purchases/new" element={<PurchaseForm />} />
      <Route path="/purchases/edit/:id" element={<PurchaseForm />} />
      <Route path="/sales" element={<Sales />} />
      <Route path="/sales/new" element={<NewSale />} />
      <Route path="/sales/fill/:id" element={<NewSale />} />
      <Route path="/stock" element={<Stock />} />
      <Route path="/stock/adjust" element={<StockAdjust />} />
      <Route path="/customers" element={<Customers />} />
      <Route path="/customers/new" element={<CustomerForm />} />
      <Route path="/customers/edit/:id" element={<CustomerForm />} />
      <Route path="/suppliers" element={<Suppliers />} />
      <Route path="/suppliers/new" element={<SupplierForm />} />
      <Route path="/suppliers/edit/:id" element={<SupplierForm />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/invoice/:id" element={<InvoiceView />} />
    </Routes>
  )
}
