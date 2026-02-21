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

export interface ClientAddress {
  id: number
  client_id: number
  label: string | null
  address: string
  created_at: string | null
}

export interface Client {
  id: number
  name: string
  email: string | null
  phone: string | null
  notes: string | null
  addresses: ClientAddress[]
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
  logo_path: string | null
  updated_at: string | null
}
