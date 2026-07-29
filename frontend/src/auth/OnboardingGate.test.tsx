import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Outlet, Route, Routes } from "react-router-dom"
import { renderWithProviders } from "@/test/utils"
import type { BusinessSettings } from "@/types/invoice"

vi.mock("@/api/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}))

import { getSettings } from "@/api/settings"
import OnboardingGate from "./OnboardingGate"

function makeSettings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  return {
    id: 1,
    user_id: "user-1",
    name: "Merrick Design Co.",
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
    default_email_message: "Hello {client_name}",
    onboarding_completed: false,
    onboarding_completed_at: null,
    updated_at: null,
    ...overrides,
  }
}

function GateHarness() {
  return (
    <Routes>
      <Route path="/onboarding" element={<div>Setup screen</div>} />
      <Route element={<OnboardingGate />}>
        <Route element={<Outlet />}>
          <Route path="/invoices" element={<div>Invoice workspace</div>} />
        </Route>
      </Route>
    </Routes>
  )
}

beforeEach(() => vi.mocked(getSettings).mockResolvedValue(makeSettings()))
afterEach(() => vi.clearAllMocks())

describe("OnboardingGate", () => {
  it("redirects an incomplete account to setup", async () => {
    renderWithProviders(<GateHarness />, { initialEntries: ["/invoices"] })
    expect(await screen.findByText("Setup screen")).toBeInTheDocument()
    expect(screen.queryByText("Invoice workspace")).not.toBeInTheDocument()
  })

  it("renders the protected workspace for a completed account", async () => {
    vi.mocked(getSettings).mockResolvedValue(makeSettings({
      onboarding_completed: true,
      onboarding_completed_at: "2026-07-26T18:00:00Z",
    }))
    renderWithProviders(<GateHarness />, { initialEntries: ["/invoices"] })
    expect(await screen.findByText("Invoice workspace")).toBeInTheDocument()
  })

  it("fails closed with Retry and no protected child when settings cannot load", async () => {
    vi.mocked(getSettings)
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue(makeSettings({ onboarding_completed: true }))
    const user = userEvent.setup()
    renderWithProviders(<GateHarness />, { initialEntries: ["/invoices"] })

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i)
    expect(screen.queryByText("Invoice workspace")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /retry/i }))
    expect(await screen.findByText("Invoice workspace")).toBeInTheDocument()
    expect(vi.mocked(getSettings).mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
