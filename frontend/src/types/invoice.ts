// TypeScript mirrors of backend Pydantic schemas

export interface ContactInfo {
  name: string | null
  address: string | null
  email: string | null
  phone: string | null
  logo_path: string | null
  tax_id: string | null
}

export interface ClientContact {
  client_id: number | null
  name: string | null
  address: string | null
  email: string | null
  phone: string | null
}

export interface LineItem {
  description: string
  quantity: number
  unit: string
  unit_price: number
  discount_pct: number
  tax_pct: number
  subtotal: number
}

export interface Totals {
  subtotal: number
  discount_total: number
  tax_total: number
  grand_total: number
}

export interface PaymentInfo {
  bank_name: string | null
  account_name: string | null
  account_number: string | null
  routing_number: string | null
  additional_instructions: string | null
}

export interface InvoiceData {
  invoice_number: string | null
  issue_date: string | null
  due_date: string | null
  currency: string
  status: string
  from: ContactInfo
  to: ClientContact
  line_items: LineItem[]
  totals: Totals
  payment_terms: string | null
  notes: string | null
  payment_info: PaymentInfo
}

export interface InvoiceRecord {
  id: number
  filename: string
  file_path: string
  source: string
  invoice_number: string | null
  client_name: string | null
  issue_date: string | null
  grand_total: number | null
  currency: string
  chroma_doc_id: string | null
  status: string
  created_at: string | null
}

export interface UploadResult {
  filename: string
  success: boolean
  record: InvoiceRecord | null
  error: string | null
}

export interface BulkUploadResponse {
  results: UploadResult[]
  total: number
  succeeded: number
  failed: number
}

export interface GenerateInvoiceResponse {
  invoice: InvoiceData
  rag_docs_used: number
}

export interface Client {
  id: number
  name: string
  address: string | null
  email: string | null
  phone: string | null
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

export interface CatalogItem {
  id: number
  description: string
  unit_price: number
  unit: string
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

export interface BusinessSettings {
  id: number
  name: string | null
  address: string | null
  email: string | null
  phone: string | null
  tax_id: string | null
  logo_path: string | null
  default_currency: string
  default_tax_pct: number
  payment_terms: string
  bank_name: string | null
  account_name: string | null
  account_number: string | null
  routing_number: string | null
  payment_notes: string | null
  updated_at: string | null
}
