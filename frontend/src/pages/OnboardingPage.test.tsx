import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Route, Routes } from "react-router-dom"
import { renderWithProviders } from "@/test/utils"
import type { BusinessSettings } from "@/types/invoice"

vi.mock("@/api/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { getSettings, updateSettings } from "@/api/settings"
import OnboardingPage from "./OnboardingPage"

function makeSettings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  return {
    id: 1,
    user_id: "user-1",
    name: "Merrick Design Co.",
    address: null,
    email: "hello@merrick.example",
    phone: "203-555-0198",
    logo_path: null,
    tax_id: null,
    default_currency: "USD",
    default_tax_pct: 6.35,
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

function Harness() {
  return (
    <Routes>
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/invoices" element={<div>Invoices destination</div>} />
    </Routes>
  )
}

beforeEach(() => {
  vi.mocked(getSettings).mockResolvedValue(makeSettings())
  vi.mocked(updateSettings).mockResolvedValue(makeSettings({ onboarding_completed: true }))
})
afterEach(() => vi.clearAllMocks())

describe("OnboardingPage", () => {
  it("shows Retry and no blank setup form when settings fail, then prefills after recovery", async () => {
    vi.mocked(getSettings)
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue(makeSettings())
    const user = userEvent.setup()
    renderWithProviders(<Harness />, { initialEntries: ["/onboarding"] })

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i)
    expect(screen.queryByRole("textbox", { name: /business name/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /retry/i }))
    expect(await screen.findByRole("textbox", { name: /business name/i })).toHaveValue("Merrick Design Co.")
  })

  it("requires a business name before advancing", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />, { initialEntries: ["/onboarding"] })
    const name = await screen.findByRole("textbox", { name: /business name/i })
    await user.clear(name)
    await user.click(screen.getByRole("button", { name: /continue/i }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/business name/i)
    expect(screen.queryByText(/invoice defaults/i)).not.toBeInTheDocument()
  })

  it("moves forward and back without losing entered values", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />, { initialEntries: ["/onboarding"] })
    const name = await screen.findByRole("textbox", { name: /business name/i })
    await user.clear(name)
    await user.type(name, "Pebble Works")
    await user.click(screen.getByRole("button", { name: /continue/i }))
    expect(screen.getByRole("heading", { name: /invoice defaults/i })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /back/i }))
    expect(screen.getByRole("textbox", { name: /business name/i })).toHaveValue("Pebble Works")
  })

  it("submits existing settings plus completion and navigates to the intended path", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />, {
      initialEntries: ["/onboarding"],
    })

    await screen.findByRole("textbox", { name: /business name/i })
    await user.click(screen.getByRole("button", { name: /continue/i }))
    await user.selectOptions(screen.getByLabelText(/currency/i), "USD")
    await user.click(screen.getByRole("button", { name: /continue/i }))
    expect(screen.getByRole("heading", { name: /review/i })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /finish setup/i }))

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1))
    expect(updateSettings).toHaveBeenCalledWith({
      name: "Merrick Design Co.",
      email: "hello@merrick.example",
      phone: "203-555-0198",
      default_currency: "USD",
      default_tax_pct: 6.35,
      payment_terms: "Net 30",
      onboarding_completed: true,
    })
    expect(await screen.findByText("Invoices destination")).toBeInTheDocument()
  })

  it("disables Finish setup while the completion request is pending", async () => {
    vi.mocked(updateSettings).mockImplementation(() => new Promise(() => {}))
    const user = userEvent.setup()
    renderWithProviders(<Harness />, { initialEntries: ["/onboarding"] })

    await screen.findByRole("textbox", { name: /business name/i })
    await user.click(screen.getByRole("button", { name: /continue/i }))
    await user.click(screen.getByRole("button", { name: /continue/i }))
    const finish = screen.getByRole("button", { name: /finish setup/i })
    await user.click(finish)
    expect(finish).toBeDisabled()
    await user.click(finish)
    expect(updateSettings).toHaveBeenCalledTimes(1)
  })
})
