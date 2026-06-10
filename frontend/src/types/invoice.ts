// TypeScript mirrors of backend Pydantic schemas

export interface ContactInfo {
  name: string | null
  address: string | null
  email: string | null
  phone: string | null
  logo_path: string | null
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
  subtotal: number
}

export interface Totals {
  subtotal: number
  grand_total: number
}

export interface InvoiceData {
  invoice_number: string | null
  issue_date: string | null
  status: string
  from: ContactInfo
  to: ClientContact
  line_items: LineItem[]
  totals: Totals
  notes: string | null
}

export interface InvoiceRecord {
  id: number
  user_id: string
  client_id: number | null
  client_invoice_sequence: number | null
  filename: string
  file_path: string
  storage_path: string | null
  source: string
  invoice_number: string | null
  client_name: string | null
  issue_date: string | null
  grand_total: number | null
  currency: string
  rag_doc_id: string | null
  status: string
  invoice_json: string | null
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

export interface NextInvoiceNumberResponse {
  client_id: number
  client_code: string
  client_invoice_sequence: number
  invoice_number: string
}

export interface ClientAddress {
  id: number
  client_id: number
  label: string | null
  address: string
  created_at: string | null
}

export interface Client {
  id: number
  user_id: string
  name: string
  client_code: string | null
  email: string | null
  phone: string | null
  notes: string | null
  addresses: ClientAddress[]
  created_at: string | null
  updated_at: string | null
}

export interface CatalogItem {
  id: number
  user_id: string
  description: string
  unit_price: number
  unit: string
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

export interface CatalogRecommendation {
  description: string
  unit_price: number
  unit: string
  notes: string | null
  confidence: number
  reason: string
  invoice_examples: string[]
}

export interface BusinessSettings {
  id: number
  user_id: string
  name: string | null
  address: string | null
  email: string | null
  phone: string | null
  logo_path: string | null
  tax_id: string | null
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

export interface Profile {
  id: string
  email: string
  display_name: string | null
  created_at: string | null
}

export interface AuthMeResponse {
  user: Profile
}
