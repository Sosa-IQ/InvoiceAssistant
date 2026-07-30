import { afterEach, beforeEach, vi } from "vitest"
import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithProviders } from "@/test/utils"
import type { InvoiceEmail, InvoiceRecord } from "@/types/invoice"

vi.mock("@/api/invoices", () => ({
  listInvoiceEmails: vi.fn(),
  sendInvoice: vi.fn(),
  openInvoicePdf: vi.fn(),
  downloadInvoicePdf: vi.fn(),
}))

vi.mock("@/api/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { listInvoiceEmails, sendInvoice, openInvoicePdf, downloadInvoicePdf } from "@/api/invoices"
import { getSettings } from "@/api/settings"
import { EmailInvoiceDialog } from "./EmailInvoiceDialog"
import type { BusinessSettings } from "@/types/invoice"

const invoiceJson = JSON.stringify({
  invoice_number: "ACME-0001",
  issue_date: "2026-07-23",
  status: "drafted",
  from: { name: "Owner Consulting", address: null, email: "billing@example.com", phone: null, logo_path: null },
  to: { client_id: 1, name: "Acme Corp", address: null, email: "client@example.com", phone: null },
  line_items: [],
  totals: { subtotal: 0, grand_total: 0 },
  notes: null,
})

function makeRecord(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
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
    issue_date: "2026-07-23",
    grand_total: 100,
    currency: "USD",
    rag_doc_id: null,
    status: "drafted",
    invoice_json: invoiceJson,
    created_at: null,
    ...overrides,
  }
}

function makeEmail(overrides: Partial<InvoiceEmail> = {}): InvoiceEmail {
  return {
    id: 1,
    user_id: "user-1",
    invoice_record_id: 42,
    recipient_email: "client@example.com",
    cc_email: "owner@example.com",
    subject: "Invoice",
    message_body: "Body",
    status: "sent",
    provider: "smtp",
    provider_message_id: "<abc@test>",
    error_message: null,
    sent_at: "2026-07-24T10:00:00Z",
    created_at: "2026-07-24T10:00:00Z",
    ...overrides,
  }
}

function makeSettings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  return {
    id: 1,
    user_id: "user-1",
    name: "Settings Business Name",
    address: null,
    email: "owner@example.com",
    phone: null,
    logo_path: null,
    tax_id: null,
    default_currency: "USD",
    default_tax_pct: 0,
    payment_terms: "Net 30",
    bank_name: null,
    account_name: null,
    account_number: null,
    routing_number: null,
    payment_notes: null,
    default_email_subject: "Invoice {invoice_number}",
    default_email_message: "Hello {client_name},\n\nPlease find invoice {invoice_number} attached.\n\nBest,\n{business_name}",
    onboarding_completed: true,
    onboarding_completed_at: "2026-07-26T18:00:00Z",
    updated_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(listInvoiceEmails).mockResolvedValue([])
  vi.mocked(sendInvoice).mockResolvedValue({ email: makeEmail() })
  vi.mocked(openInvoicePdf).mockResolvedValue(undefined)
  vi.mocked(getSettings).mockResolvedValue(makeSettings())
  vi.mocked(downloadInvoicePdf).mockResolvedValue(new Blob())
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("EmailInvoiceDialog — characterization (A0)", () => {
  it("renders From / Reply-To / Recipient / CC / Subject / Message", async () => {
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    expect(await screen.findByText("From")).toBeInTheDocument()
    expect(screen.getByText("Reply-To")).toBeInTheDocument()
    expect(screen.getByText("Recipient")).toBeInTheDocument()
    expect(screen.getByText("CC")).toBeInTheDocument()
    expect(screen.getByText("Subject")).toBeInTheDocument()
    expect(screen.getByText("Message")).toBeInTheDocument()
  })

  it("renders Preview and Download buttons and a Send History section", async () => {
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    expect(await screen.findByRole("button", { name: /preview pdf/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /download pdf/i })).toBeInTheDocument()
    expect(screen.getByText("Send History")).toBeInTheDocument()
  })

  it("disables Send when the subject is blank", async () => {
    const user = userEvent.setup()
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    const send = await screen.findByRole("button", { name: /send invoice/i })
    const subject = screen.getByLabelText("Subject")
    await waitFor(() => expect(subject).not.toHaveValue(""))
    expect(send).toBeEnabled()

    await user.clear(subject)
    expect(send).toBeDisabled()
  })

  it("loads and shows send history for the record", async () => {
    vi.mocked(listInvoiceEmails).mockResolvedValue([makeEmail()])
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    await waitFor(() => expect(listInvoiceEmails).toHaveBeenCalledWith(42))
    expect(await screen.findByText(/client@example.com/)).toBeInTheDocument()
    expect(screen.getByText("sent")).toBeInTheDocument()
  })

  it("focuses the compose heading when a mounted closed dialog opens", async () => {
    const { rerender } = renderWithProviders(
      <EmailInvoiceDialog record={null} onOpenChange={() => {}} />,
    )

    rerender(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    const heading = await screen.findByRole("heading", { name: "Email Invoice" })
    await waitFor(() => expect(heading).toHaveFocus())
  })
})

describe("EmailInvoiceDialog — viewport fit (R4)", () => {
  it("caps the dialog height and lays it out as a flex column", async () => {
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    const content = await screen.findByRole("dialog")
    expect(content.className).toMatch(/max-h-\[90dvh\]/)
    expect(content.className).toMatch(/flex-col/)
  })

  it("scrolls the body in a bounded region with header and footer outside it", async () => {
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    const scrollBody = await screen.findByTestId("dialog-scroll-body")
    expect(scrollBody.className).toMatch(/overflow-y-auto/)
    expect(scrollBody.className).toMatch(/min-h-0/)

    const title = screen.getByText("Email Invoice")
    const sendButton = screen.getByRole("button", { name: /send invoice/i })
    expect(scrollBody.contains(title)).toBe(false)
    expect(scrollBody.contains(sendButton)).toBe(false)
  })

  it("bounds the send-history region with its own scroll", async () => {
    vi.mocked(listInvoiceEmails).mockResolvedValue([makeEmail(), makeEmail({ id: 2 }), makeEmail({ id: 3 })])
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    const history = await screen.findByTestId("send-history")
    expect(history.className).toMatch(/overflow-y-auto/)
    expect(history.className).toMatch(/max-h-/)
  })
})

describe("EmailInvoiceDialog — editable delivery and result states (R2/R3/R5)", () => {
  it("keeps failed attempts out of the visible history defensively", async () => {
    vi.mocked(listInvoiceEmails).mockResolvedValue([
      makeEmail({ id: 2, status: "failed", recipient_email: "failed@example.com" }),
      makeEmail({ id: 3, status: "pending", recipient_email: "pending@example.com" }),
      makeEmail({ id: 1, status: "sent", recipient_email: "client@example.com" }),
    ])
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    expect(await screen.findByText(/client@example.com/)).toBeInTheDocument()
    expect(screen.queryByText(/failed@example.com/)).not.toBeInTheDocument()
    expect(screen.queryByText(/pending@example.com/)).not.toBeInTheDocument()
  })

  it("allows From, Reply-To, Recipient, and CC to be edited", async () => {
    const user = userEvent.setup()
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    for (const [label, value] of [
      ["From", "New Sender"],
      ["Reply-To", "reply@example.com"],
      ["Recipient", "other@example.com"],
      ["CC", "cc@example.com"],
    ] as const) {
      const input = await screen.findByLabelText(label)
      await user.clear(input)
      await user.type(input, value)
      expect(input).toHaveValue(value)
    }
  })

  it("sends directly with defaults when no delivery field changed", async () => {
    const user = userEvent.setup()
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    await user.click(await screen.findByRole("button", { name: /send invoice/i }))
    await waitFor(() => expect(sendInvoice).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/confirm delivery changes/i)).not.toBeInTheDocument()
    expect(sendInvoice).toHaveBeenCalledWith(42, expect.objectContaining({
      from_display_name: "Owner Consulting",
      reply_to_email: "billing@example.com",
      recipient_email: "client@example.com",
      cc_email: "owner@example.com",
    }))
  })

  it("lists only changed delivery fields and waits for confirmation", async () => {
    const user = userEvent.setup()
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    const recipient = await screen.findByLabelText("Recipient")
    const cc = screen.getByLabelText("CC")
    await user.clear(recipient)
    await user.type(recipient, "other@example.com")
    await user.clear(cc)
    await user.type(cc, "changed-cc@example.com")
    await user.click(screen.getByRole("button", { name: /send invoice/i }))

    expect(screen.getByRole("heading", { name: /confirm delivery changes/i })).toBeInTheDocument()
    expect(screen.getByText("Recipient")).toBeInTheDocument()
    expect(screen.getByText("CC")).toBeInTheDocument()
    expect(screen.queryByText("Reply-To")).not.toBeInTheDocument()
    expect(sendInvoice).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: /confirm and send/i }))
    await waitFor(() => expect(sendInvoice).toHaveBeenCalledTimes(1))
    expect(sendInvoice).toHaveBeenCalledWith(42, expect.objectContaining({
      recipient_email: "other@example.com",
      cc_email: "changed-cc@example.com",
    }))
  })

  it("freezes and prevents dismissal while a send is unresolved", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    let resolveSend!: (value: { email: InvoiceEmail }) => void
    vi.mocked(sendInvoice).mockImplementation(
      () => new Promise((resolve) => { resolveSend = resolve }),
    )
    vi.mocked(listInvoiceEmails).mockRejectedValue(new Error("history unavailable"))
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={onOpenChange} />)

    const retryHistory = await screen.findByRole("button", { name: /retry history/i })
    await user.click(await screen.findByRole("button", { name: /send invoice/i }))

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true")
    expect(screen.getByLabelText("Recipient")).toBeDisabled()
    expect(screen.getByLabelText("Subject")).toBeDisabled()
    expect(screen.getByLabelText("Message")).toBeDisabled()
    expect(screen.getByRole("button", { name: /preview pdf/i })).toBeDisabled()
    expect(retryHistory).toBeDisabled()
    expect(screen.queryByRole("button", { name: /^close$/i })).not.toBeInTheDocument()
    await user.keyboard("{Escape}")
    fireEvent.pointerDown(document.body)
    expect(onOpenChange).not.toHaveBeenCalled()

    resolveSend({ email: makeEmail() })
    expect(await screen.findByRole("heading", { name: "Invoice sent" })).toBeInTheDocument()
  })

  it("replaces the composer with a simple Sent confirmation on success", async () => {
    const user = userEvent.setup()
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    await user.click(await screen.findByRole("button", { name: /send invoice/i }))

    expect(await screen.findByRole("heading", { name: "Invoice sent" })).toBeInTheDocument()
    expect(screen.getByText(/sent to client@example.com/i)).toBeInTheDocument()
    expect(screen.queryByLabelText("Subject")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /send invoice/i })).not.toBeInTheDocument()
  })

  it("retains the composition and shows an inline retry error when sending fails", async () => {
    vi.mocked(sendInvoice).mockRejectedValueOnce(new Error("Email send failed. Please try again."))
    const user = userEvent.setup()
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    const subject = await screen.findByLabelText("Subject")
    await waitFor(() => expect(subject).not.toHaveValue(""))
    await user.clear(subject)
    await user.type(subject, "Keep this subject")
    await user.click(screen.getByRole("button", { name: /send invoice/i }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Email send failed. Please try again.")
    expect(subject).toHaveValue("Keep this subject")
    expect(screen.getByRole("button", { name: /retry send/i })).toBeInTheDocument()
  })

  it("reuses one idempotency key for a failed attempt and its retry", async () => {
    const user = userEvent.setup()
    vi.mocked(sendInvoice)
      .mockRejectedValueOnce(new Error("Email send failed. Please try again."))
      .mockResolvedValueOnce({ email: makeEmail() })
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={vi.fn()} />)

    await user.click(await screen.findByRole("button", { name: /send invoice/i }))
    await user.click(await screen.findByRole("button", { name: /retry send/i }))
    await waitFor(() => expect(sendInvoice).toHaveBeenCalledTimes(2))

    const firstKey = vi.mocked(sendInvoice).mock.calls[0][1].idempotency_key
    const retryKey = vi.mocked(sendInvoice).mock.calls[1][1].idempotency_key
    expect(firstKey).toMatch(/^[A-Za-z0-9._-]{8,128}$/)
    expect(retryKey).toBe(firstKey)
  })
})

describe("EmailInvoiceDialog — tenant email templates", () => {
  it("initializes subject and message by interpolating the tenant's saved templates", async () => {
    vi.mocked(getSettings).mockResolvedValue(
      makeSettings({
        name: "Settings Business Name",
        default_email_subject: "{business_name}: invoice {invoice_number}",
        default_email_message:
          "Hi {client_name}, due {total} {currency} by {issue_date}. - {business_name}",
      }),
    )
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    await waitFor(() =>
      expect(screen.getByLabelText("Subject")).toHaveValue("Owner Consulting: invoice ACME-0001"),
    )
    expect(screen.getByLabelText("Message")).toHaveValue(
      "Hi Acme Corp, due 100.00 USD by 2026-07-23. - Owner Consulting",
    )
  })

  it("falls back to the built-in default templates when settings have no override needed", async () => {
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    await waitFor(() => expect(screen.getByLabelText("Subject")).toHaveValue("Invoice ACME-0001"))
    expect(screen.getByLabelText("Message")).toHaveValue(
      "Hello Acme Corp,\n\nPlease find invoice ACME-0001 attached.\n\nBest,\nOwner Consulting",
    )
  })

  it("waits for the settings query to resolve before applying a template", async () => {
    let resolveSettings!: (value: BusinessSettings) => void
    vi.mocked(getSettings).mockImplementation(
      () => new Promise((resolve) => { resolveSettings = resolve }),
    )
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    const subject = await screen.findByLabelText("Subject")
    expect(subject).toHaveValue("")

    await act(async () => {
      resolveSettings(makeSettings())
    })

    await waitFor(() => expect(subject).toHaveValue("Invoice ACME-0001"))
  })

  it("does not silently fall back when settings fail; retry initializes the saved template once", async () => {
    vi.mocked(getSettings)
      .mockRejectedValueOnce(new Error("settings unavailable"))
      .mockResolvedValue(makeSettings({ default_email_subject: "Saved {invoice_number}" }))
    const user = userEvent.setup()
    const { queryClient } = renderWithProviders(
      <EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />,
    )

    // Inline, accessible error + retry — never the built-in fallback template.
    const retry = await screen.findByRole("button", { name: /retry template/i })
    const subject = screen.getByLabelText("Subject")
    const message = screen.getByLabelText("Message")
    expect(subject).toHaveValue("")
    expect(message).toHaveValue("")
    expect(screen.getByRole("button", { name: /send invoice/i })).toBeDisabled()

    // Retry that succeeds initializes the saved template.
    await user.click(retry)
    await waitFor(() => expect(subject).toHaveValue("Saved ACME-0001"))
    expect(getSettings).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole("button", { name: /retry template/i })).not.toBeInTheDocument()

    // Exactly once: a later successful settings refetch must not re-initialize.
    await user.clear(subject)
    await user.type(subject, "My own subject")
    vi.mocked(getSettings).mockResolvedValue(
      makeSettings({ default_email_subject: "Another {invoice_number}" }),
    )
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] })
    })
    expect(subject).toHaveValue("My own subject")
  })

  it("does not overwrite user edits when settings refetch while the dialog stays open", async () => {
    const user = userEvent.setup()
    const { queryClient } = renderWithProviders(
      <EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />,
    )

    const subject = await screen.findByLabelText("Subject")
    await waitFor(() => expect(subject).toHaveValue("Invoice ACME-0001"))

    await user.clear(subject)
    await user.type(subject, "My custom subject")
    expect(subject).toHaveValue("My custom subject")

    vi.mocked(getSettings).mockResolvedValue(
      makeSettings({ default_email_subject: "A totally different template {invoice_number}" }),
    )
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] })
    })

    expect(subject).toHaveValue("My custom subject")
  })
})

describe("EmailInvoiceDialog — Confirm Delivery Changes shows saved and new values", () => {
  function makeRecordWithBlankBaselineRecipient(): InvoiceRecord {
    const invoice = JSON.parse(invoiceJson)
    invoice.to.email = null
    return makeRecord({ invoice_json: JSON.stringify(invoice) })
  }

  it("shows the saved value and the new send value for each changed field, with Not set for blanks", async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <EmailInvoiceDialog record={makeRecordWithBlankBaselineRecipient()} onOpenChange={() => {}} />,
    )

    const recipient = await screen.findByLabelText("Recipient")
    await user.clear(recipient)
    await user.type(recipient, "changed@example.com")
    await user.click(screen.getByRole("button", { name: /send invoice/i }))

    expect(screen.getByRole("heading", { name: /confirm delivery changes/i })).toBeInTheDocument()

    const recipientTerm = screen.getByText("Recipient", { selector: "dt" })
    const recipientRow = recipientTerm.closest("div")
    expect(recipientRow).not.toBeNull()
    expect(recipientRow).toHaveTextContent("Not set")
    expect(recipientRow).toHaveTextContent("changed@example.com")
    expect(screen.getAllByText("Saved").every((label) => !label.classList.contains("sr-only"))).toBe(true)
    expect(screen.getAllByText("Sending").every((label) => !label.classList.contains("sr-only"))).toBe(true)
  })

  it("uses accessible dt/dd definition-list semantic markup for the changed-field list", async () => {
    const user = userEvent.setup()
    renderWithProviders(<EmailInvoiceDialog record={makeRecord()} onOpenChange={() => {}} />)

    const recipient = await screen.findByLabelText("Recipient")
    const cc = screen.getByLabelText("CC")
    await user.clear(recipient)
    await user.type(recipient, "other@example.com")
    await user.clear(cc)
    await user.type(cc, "changed-cc@example.com")
    await user.click(screen.getByRole("button", { name: /send invoice/i }))

    const list = screen.getByLabelText("Changed delivery fields")
    expect(list.tagName).toBe("DL")

    const recipientRow = screen.getByText("Recipient", { selector: "dt" }).closest("div")
    expect(recipientRow?.querySelector("dd")).not.toBeNull()
    expect(recipientRow).toHaveTextContent("client@example.com")
    expect(recipientRow).toHaveTextContent("other@example.com")

    const ccRow = screen.getByText("CC", { selector: "dt" }).closest("div")
    expect(ccRow?.querySelector("dd")).not.toBeNull()
    expect(ccRow).toHaveTextContent("owner@example.com")
    expect(ccRow).toHaveTextContent("changed-cc@example.com")
  })
})
