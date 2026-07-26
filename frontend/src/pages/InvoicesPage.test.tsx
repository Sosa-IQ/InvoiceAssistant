import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, vi } from "vitest"

import { renderWithProviders } from "@/test/utils"
import type { InvoiceRecord } from "@/types/invoice"

vi.mock("@/api/invoices", () => ({
  deleteInvoice: vi.fn(),
  indexInvoice: vi.fn(),
  listInvoices: vi.fn(),
  openInvoicePdf: vi.fn(),
  uploadInvoices: vi.fn(),
}))

vi.mock("@/components/EmailInvoiceDialog", () => ({
  EmailInvoiceDialog: ({ record }: { record: InvoiceRecord | null }) =>
    record ? <div role="dialog">Email history for invoice {record.id}</div> : null,
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { listInvoices } from "@/api/invoices"
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
    status: "exported",
    invoice_json: JSON.stringify({
      invoice_number: "ACME-0001",
      issue_date: "2026-07-26",
      status: "exported",
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
})

describe("InvoicesPage history actions", () => {
  it("opens email history for an exported invoice with no saved recipient", async () => {
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
})
