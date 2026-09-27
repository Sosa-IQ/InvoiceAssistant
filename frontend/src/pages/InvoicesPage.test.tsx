import { act, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, vi } from "vitest"

import { renderWithProviders } from "@/test/utils"
import type { InvoiceRecord } from "@/types/invoice"

vi.mock("@/api/invoices", () => ({
  deleteInvoice: vi.fn(),
  listInvoices: vi.fn(),
  openInvoicePdf: vi.fn(),
  updateInvoiceStatus: vi.fn(),
  uploadInvoices: vi.fn(),
}))

vi.mock("@/api/billing", () => ({
  getBillingStatus: vi.fn(),
  getUsageStatus: vi.fn(),
  createCheckoutSession: vi.fn(),
}))

vi.mock("@/components/EmailInvoiceDialog", () => ({
  EmailInvoiceDialog: ({ record }: { record: InvoiceRecord | null }) =>
    record ? <div role="dialog">Email history for invoice {record.id}</div> : null,
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { listInvoices } from "@/api/invoices"
import { getBillingStatus, getUsageStatus } from "@/api/billing"
import InvoicesPage from "./InvoicesPage"

function exportedInvoiceWithoutRecipient(): InvoiceRecord {
  return {
    id: 42,
    user_id: "user-1",
    client_id: 1,
    client_invoice_sequence: 1,
    filename: "ACME-0001.pdf",
    file_path: "/tmp/ACME-0001.pdf",
    storage_path: "user-1/ACME-0001.pdf",
    source: "generated",
    invoice_number: "ACME-0001",
    client_name: "Acme Corp",
    issue_date: "2026-07-26",
    grand_total: 100,
    currency: "USD",
    rag_doc_id: null,
    status: "drafted",
    invoice_json: JSON.stringify({
      invoice_number: "ACME-0001",
      issue_date: "2026-07-26",
      status: "drafted",
      from: { name: "Owner", email: "owner@example.com" },
      to: { client_id: 1, name: "Acme Corp", email: null },
      line_items: [],
      totals: { subtotal: 100, grand_total: 100 },
    }),
    created_at: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
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
})

describe("InvoicesPage history actions", () => {
  it("opens email history for a drafted invoice with no saved recipient", async () => {
    const user = userEvent.setup()
    vi.mocked(listInvoices).mockResolvedValue([exportedInvoiceWithoutRecipient()])
    renderWithProviders(<InvoicesPage />)

    await user.click(await screen.findByRole("button", { name: "Email invoice" }))

    expect(screen.getByRole("dialog")).toHaveTextContent("Email history for invoice 42")
  })

  it("shows a query error and retries invoice history", async () => {
    const user = userEvent.setup()
    vi.mocked(listInvoices)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([])
    renderWithProviders(<InvoicesPage />)

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load invoice history.",
    )
    await user.click(screen.getByRole("button", { name: "Retry" }))

    await waitFor(() => expect(listInvoices).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
  })

  it("lets a Free account email while it has allowance left", async () => {
    const user = userEvent.setup()
    vi.mocked(getBillingStatus).mockResolvedValue({
      plan: "free",
      status: "free",
      stripe_customer_id: null,
      stripe_subscription_id: null,
      stripe_price_id: null,
      current_period_end: null,
      cancel_at_period_end: false,
      configured: true,
      enforcement_enabled: true,
    })
    vi.mocked(getUsageStatus).mockResolvedValue({
      email_monthly_limit: 5,
      emails_sent_this_period: 4,
    } as Awaited<ReturnType<typeof getUsageStatus>>)
    vi.mocked(listInvoices).mockResolvedValue([exportedInvoiceWithoutRecipient()])
    renderWithProviders(<InvoicesPage />)

    await user.click(await screen.findByRole("button", { name: "Email invoice" }))

    expect(screen.getByRole("dialog")).toHaveTextContent("Email history for invoice 42")
  })

  it("offers Pro once the Free email allowance is used up", async () => {
    const user = userEvent.setup()
    vi.mocked(getUsageStatus).mockResolvedValue({
      email_monthly_limit: 5,
      emails_sent_this_period: 5,
    } as Awaited<ReturnType<typeof getUsageStatus>>)
    vi.mocked(listInvoices).mockResolvedValue([exportedInvoiceWithoutRecipient()])
    renderWithProviders(<InvoicesPage />)

    const emailButton = await screen.findByRole("button", { name: "Email invoice" })
    await waitFor(() => expect(getUsageStatus).toHaveBeenCalled())
    await act(async () => {}) // let the usage query resolve before clicking
    await user.click(emailButton)

    expect(screen.getByRole("dialog")).toHaveTextContent("used this month's free invoice emails")
  })
})
