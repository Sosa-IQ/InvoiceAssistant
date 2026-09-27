import { beforeEach, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithProviders } from "@/test/utils"
import type { InvoiceData, InvoiceRecord } from "@/types/invoice"

const navigate = vi.fn()
const blocker = vi.hoisted(() => ({ current: { state: "unblocked" } as { state: string; reset?: () => void; proceed?: () => void } }))

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>()
  return {
    ...actual,
    useLocation: () => ({ pathname: "/invoices/editor", state: { invoice } }),
    useNavigate: () => navigate,
    useBlocker: () => blocker.current,
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

vi.mock("@/api/billing", () => ({
  getBillingStatus: vi.fn(),
  getUsageStatus: vi.fn(),
  createCheckoutSession: vi.fn(),
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
import { getBillingStatus, getUsageStatus } from "@/api/billing"
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
  blocker.current = { state: "unblocked" }
  vi.mocked(getUsageStatus).mockResolvedValue({
    email_monthly_limit: null,
    emails_sent_this_period: 0,
  } as Awaited<ReturnType<typeof getUsageStatus>>)
  vi.mocked(getBillingStatus).mockResolvedValue({
    plan: "pro",
    status: "active",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    stripe_price_id: "price_1",
    current_period_end: null,
    cancel_at_period_end: false,
    configured: true,
    enforcement_enabled: false,
  })
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

describe("InvoiceEditorPage drafts and guards", () => {
  it("restores in-progress edits after a refresh instead of the original invoice", async () => {
    const user = userEvent.setup()
    const first = renderWithProviders(<InvoiceEditorPage />)
    const description = await screen.findByDisplayValue("Work")
    await user.clear(description)
    await user.type(description, "Work, revised")
    first.unmount()

    // Same navigation state, as after a browser refresh.
    renderWithProviders(<InvoiceEditorPage />)
    expect(await screen.findByDisplayValue("Work, revised")).toBeInTheDocument()
  })

  it("won't save a line item without a description", async () => {
    const user = userEvent.setup()
    renderWithProviders(<InvoiceEditorPage />)
    await user.clear(await screen.findByDisplayValue("Work"))
    await user.click(screen.getByRole("button", { name: /^save$/i }))

    expect(await screen.findByText("Add a description")).toBeInTheDocument()
    expect(saveInvoice).not.toHaveBeenCalled()
  })

  it("asks in the app, not the browser, before leaving with unsaved changes", async () => {
    const reset = vi.fn()
    const proceed = vi.fn()
    blocker.current = { state: "blocked", reset, proceed }
    const user = userEvent.setup()
    renderWithProviders(<InvoiceEditorPage />)

    expect(await screen.findByRole("heading", { name: "Leave without saving?" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Keep editing" }))
    expect(reset).toHaveBeenCalled()
    expect(proceed).not.toHaveBeenCalled()
  })
})

