import type {
  BulkUploadResponse,
  GenerateInvoiceResponse,
  InvoiceData,
  InvoiceRecord,
} from "@/types/invoice"
import api from "./client"

export async function uploadInvoices(files: File[]): Promise<BulkUploadResponse> {
  const form = new FormData()
  files.forEach((f) => form.append("files", f))
  const { data } = await api.post<BulkUploadResponse>("/api/invoices/upload", form)
  return data
}

export async function listInvoices(): Promise<InvoiceRecord[]> {
  const { data } = await api.get<InvoiceRecord[]>("/api/invoices")
  return data
}

export async function generateInvoice(prompt: string): Promise<GenerateInvoiceResponse> {
  const { data } = await api.post<GenerateInvoiceResponse>("/api/invoices/generate", { prompt })
  return data
}

export async function exportInvoice(invoice: InvoiceData): Promise<Blob> {
  const { data } = await api.post<Blob>("/api/invoices/export", invoice, {
    responseType: "blob",
  })
  return data
}

export async function openInvoicePdf(recordId: number): Promise<void> {
  const { data } = await api.get<Blob>(`/api/invoices/${recordId}/pdf`, {
    responseType: "blob",
  })
  const url = URL.createObjectURL(data)
  window.open(url, "_blank")
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
