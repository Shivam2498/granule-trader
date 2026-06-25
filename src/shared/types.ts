export type PaymentStatus = 'pending' | 'done'
export type SaleStatus = 'reserved' | 'created'

export interface Purchase {
  id: number
  our_code: string
  supplier_invoice_number: string
  invoice_date: string          // 'YYYY-MM-DD'
  party: string
  party_state: string
  party_city: string
  party_pincode: string
  party_address: string
  hsn_code: string
  qty_kg: number
  qty_remaining_kg: number
  rate_per_kg: number
  amount: number
  cgst: number
  sgst: number
  igst: number
  tcs: number
  roundoff: number
  total_invoice_amount: number
  payment_status: PaymentStatus
  payment_date: string | null
  fy_label: string
  code_seq: number
  created_at: string
}

export interface Customer {
  id: number
  name: string
  gstin: string
  pan: string
  phone: string
  billing_address: string
  billing_city: string
  billing_state: string
  billing_pincode: string
  shipping_same: boolean
  shipping_address: string
  shipping_city: string
  shipping_state: string
  shipping_pincode: string
}

export interface SaleAllocation {
  id: number
  sale_id: number
  purchase_id: number
  hsn_code: string
  gst_rate: number
  qty_drawn_kg: number
  rate_per_kg: number
  line_amount: number
}

export interface Sale {
  id: number
  invoice_number: string
  prefix: string
  seq: number
  fy_label: string
  status: SaleStatus
  invoice_date: string | null
  eway_bill_no: string | null
  eway_bill_date: string | null
  vehicle: string | null
  buyer_customer_id: number | null
  buyer_name: string
  buyer_gstin: string
  buyer_billing_json: string     // snapshot JSON of address block
  buyer_shipping_json: string
  amount: number
  cgst: number
  sgst: number
  igst: number
  tcs: number
  roundoff: number
  total_invoice_amount: number
  total_qty_kg: number
  payment_status: PaymentStatus
  payment_date: string | null
  created_at: string
}

export interface StockAdjustment {
  id: number
  purchase_id: number
  qty_kg: number
  reason: string
  date: string
  created_at: string
}

export interface HsnProduct { hsn_code: string; description: string; gst_rate: number }

export interface Settings {
  seller_name: string
  seller_address: string
  seller_gstin: string
  seller_pan: string
  seller_phone: string
  home_state: string
  invoice_prefix: string
  default_gst_rate: number
  data_folder: string
  low_stock_threshold: number
  backups_to_keep: number
}

export interface TaxResult {
  taxable_amount: number
  cgst: number
  sgst: number
  igst: number
  tcs: number
  roundoff: number
  total: number
}

export interface AvailableLot {
  purchase_id: number
  our_code: string
  party: string
  hsn_code: string
  invoice_date: string
  available_kg: number
}

export interface LedgerRow {
  purchase_id: number
  our_code: string
  hsn_code: string
  party: string
  invoice_date: string
  qty_kg: number
  consumed_kg: number
  balance_kg: number
}
