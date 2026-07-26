import { beforeEach, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithProviders } from "@/test/utils"
import type { InvoiceData, InvoiceRecord } from "@/types/invoice"

const navigate = vi.fn()

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>()
  return {
    ...actual,
    useLocation: () => ({ pathname: "/invoices/editor", state: { invoice } }),
    useNavigate: () => navigate,
    useBlocker: () => ({ state: "unblocked" }),
  }
})

vi.mock("@/api/invoices", () => ({
  saveInvoice: vi.fn(),
  exportInvoice: vi.fn(),
  getNextInvoiceNumber: vi.fn(),
  listInvoiceEmails: vi.fn(),
  sendInvoice: vi.fn(),
  openInvoicePdf: vi.fn(),
  downloadInvoicePdf: vi.fn(),
}))

vi.mock("@/api/clients", () => ({
  listClients: vi.fn(),
  createClient: vi.fn(),
  createClientAddress: vi.fn(),
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import {
  downloadInvoicePdf,
  listInvoiceEmails,
  openInvoicePdf,
  saveInvoice,
  sendInvoice,
} from "@/api/invoices"
import { listClients } from "@/api/clients"
import InvoiceEditorPage from "./InvoiceEditorPage"

const invoice: InvoiceData = {
  invoice_number: "ACME-0001",
  issue_date: "2026-07-25",
  status: "draft",
  from: { name: "Owner Consulting", address: null, email: "billing@example.com", phone: null, logo_path: null },
  to: { client_id: 1, name: "Acme Corp", address: null, email: "client@example.com", phone: null },
  line_items: [{ description: "Work", quantity: 1, unit: "item", unit_price: 100, subtotal: 100 }],
  totals: { subtotal: 100, grand_total: 100 },
  notes: null,
}

const savedRecord: InvoiceRecord = {
  id: 42,
  user_id: "user-1",
  client_id: 1,
  client_invoice_sequence: 1,
  filename: "ACME-0001.pdf",
  file_path: "/tmp/ACME-0001.pdf",
  storage_path: null,
  source: "generated",
  invoice_number: "ACME-0001",
  client_name: "Acme Corp",
  issue_date: "2026-07-25",
  grand_total: 100,
  currency: "USD",
  rag_doc_id: null,
  status: "exported",
  invoice_json: JSON.stringify(invoice),
  created_at: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(listClients).mockResolvedValue([{ id: 1, user_id: "user-1", name: "Acme Corp", client_code: "ACME", email: "client@example.com", phone: null, notes: null, addresses: [], created_at: null, updated_at: null }])
  vi.mocked(saveInvoice).mockResolvedValue(savedRecord)
  vi.mocked(listInvoiceEmails).mockResolvedValue([])
  vi.mocked(sendInvoice).mockResolvedValue({ email: { id: 1 } as never })
  vi.mocked(openInvoicePdf).mockResolvedValue(undefined)
  vi.mocked(downloadInvoicePdf).mockResolvedValue(new Blob())
})

describe("InvoiceEditorPage save-first flow (R1)", () => {
  it("saves without downloading, then prompts to email the saved invoice", async () => {
    const user = userEvent.setup()
    renderWithProviders(<InvoiceEditorPage />)

    expect(await screen.findByRole("button", { name: /^save$/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /export pdf/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /^save$/i }))
    await waitFor(() => expect(saveInvoice).toHaveBeenCalledWith(expect.objectContaining({ invoice_number: "ACME-0001" })))

    expect(await screen.findByRole("heading", { name: /email this invoice now/i })).toBeInTheDocument()
    expect(localStorage.getItem("invoice_draft")).toBeNull()
  })

  it("opens the shared email modal with Preview and Download after accepting", async () => {
    const user = userEvent.setup()
    renderWithProviders(<InvoiceEditorPage />)

    await user.click(await screen.findByRole("button", { name: /^save$/i }))
    await user.click(await screen.findByRole("button", { name: /email invoice/i }))

    expect(await screen.findByRole("heading", { name: "Email Invoice" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /preview pdf/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /download pdf/i })).toBeInTheDocument()
  })
})
