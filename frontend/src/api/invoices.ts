import type {
  BulkUploadResponse,
  GenerateInvoiceResponse,
  InvoiceData,
  InvoiceEmail,
  InvoiceRecord,
  NextInvoiceNumberResponse,
  SendInvoiceRequest,
  SendInvoiceResponse,
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

export async function reviseInvoice(
  instruction: string,
  invoice: InvoiceData,
): Promise<GenerateInvoiceResponse> {
  const { data } = await api.post<GenerateInvoiceResponse>("/api/invoices/revise", {
    instruction,
    invoice,
  })
  return data
}

export async function createInvoiceDraft(): Promise<InvoiceData> {
  const { data } = await api.get<InvoiceData>("/api/invoices/draft")
  return data
}

export async function getNextInvoiceNumber(clientId: number): Promise<NextInvoiceNumberResponse> {
  const { data } = await api.get<NextInvoiceNumberResponse>("/api/invoices/next-number", {
    params: { client_id: clientId },
  })
  return data
}

export async function saveInvoice(invoice: InvoiceData): Promise<InvoiceRecord> {
  const { data } = await api.post<InvoiceRecord>("/api/invoices/save", invoice)
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

export async function downloadInvoicePdf(recordId: number): Promise<Blob> {
  const { data } = await api.get<Blob>(`/api/invoices/${recordId}/download`, {
    responseType: "blob",
  })
  return data
}

export async function indexInvoice(recordId: number): Promise<InvoiceRecord> {
  const { data } = await api.post<InvoiceRecord>(`/api/invoices/${recordId}/index`)
  return data
}

export async function deleteInvoice(recordId: number): Promise<void> {
  await api.delete(`/api/invoices/${recordId}`)
}

export async function listInvoiceEmails(recordId: number): Promise<InvoiceEmail[]> {
  const { data } = await api.get<InvoiceEmail[]>(`/api/invoices/${recordId}/emails`)
  return data
}

export async function sendInvoice(recordId: number, payload: SendInvoiceRequest): Promise<SendInvoiceResponse> {
  const { data } = await api.post<SendInvoiceResponse>(`/api/invoices/${recordId}/send`, payload)
  return data
}
