import { afterEach, beforeEach, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithProviders } from "@/test/utils"
import type { BusinessSettings } from "@/types/invoice"

vi.mock("@/api/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { getSettings, updateSettings } from "@/api/settings"
import SettingsPage from "./SettingsPage"

function makeSettings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  return {
    id: 1,
    user_id: "user-1",
    name: "Owner Consulting",
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
    updated_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(getSettings).mockResolvedValue(makeSettings())
  vi.mocked(updateSettings).mockResolvedValue(makeSettings())
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("SettingsPage — email template controls", () => {
  it("renders the subject and message template fields populated from settings", async () => {
    renderWithProviders(<SettingsPage />)

    const subject = await screen.findByLabelText(/default email subject/i)
    const message = await screen.findByLabelText(/default email message/i)
    expect(subject).toHaveValue("Invoice {invoice_number}")
    expect(message).toHaveValue(
      "Hello {client_name},\n\nPlease find invoice {invoice_number} attached.\n\nBest,\n{business_name}",
    )
  })

  it("shows help text listing every allowed placeholder", async () => {
    renderWithProviders(<SettingsPage />)

    await screen.findByLabelText(/default email subject/i)
    for (const placeholder of [
      "{invoice_number}",
      "{client_name}",
      "{business_name}",
      "{issue_date}",
      "{total}",
      "{currency}",
    ]) {
      expect(screen.getByText(placeholder, { selector: "code" })).toBeInTheDocument()
    }
  })

  it("shows an accessible error and Retry with no editable form when settings fail to load", async () => {
    vi.mocked(getSettings)
      .mockRejectedValueOnce(new Error("settings unavailable"))
      .mockResolvedValue(makeSettings())
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/couldn.?t|could not|failed|unable/i)

    // No way to edit or persist settings while the load is broken.
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/default email subject/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/default email message/i)).not.toBeInTheDocument()

    // Retry refetches and then renders the populated controls.
    await user.click(screen.getByRole("button", { name: /retry/i }))

    const subject = await screen.findByLabelText(/default email subject/i)
    expect(subject).toHaveValue("Invoice {invoice_number}")
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(getSettings).toHaveBeenCalledTimes(2)
  })

  it("submits edited subject and message in the persistence payload", async () => {
    const user = userEvent.setup()
    renderWithProviders(<SettingsPage />)

    const subject = await screen.findByLabelText(/default email subject/i)
    await user.clear(subject)
    await user.type(subject, "Invoice {{invoice_number} is ready")

    const message = screen.getByLabelText(/default email message/i)
    await user.clear(message)
    await user.type(message, "Thanks {{client_name} - {{business_name}")

    await user.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1))
    const payload = vi.mocked(updateSettings).mock.calls[0][0]
    expect(payload).toEqual(
      expect.objectContaining({
        default_email_subject: "Invoice {invoice_number} is ready",
        default_email_message: "Thanks {client_name} - {business_name}",
      }),
    )
  })
})
