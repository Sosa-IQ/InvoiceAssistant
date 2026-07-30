import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Route, Routes } from "react-router-dom"
import { renderWithProviders } from "@/test/utils"

vi.mock("@/api/billing", () => ({
  getBillingPlans: vi.fn(),
  createCheckoutSession: vi.fn(),
}))
vi.mock("@/lib/externalNavigation", () => ({ redirectToStripe: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { createCheckoutSession, getBillingPlans, type BillingPlansResponse } from "@/api/billing"
import { redirectToStripe } from "@/lib/externalNavigation"
import PricingPage from "./PricingPage"

const plans: BillingPlansResponse = {
  configured: true,
  enforcement_enabled: false,
  plans: [
    { code: "free", name: "Free", price_cents: 0, currency: "USD", interval: "month", features: ["Create and edit invoices"] },
    { code: "pro", name: "Pro", price_cents: 1200, currency: "USD", interval: "month", features: ["Email invoice delivery", "AI-assisted drafting and edits", "Voice input"] },
  ],
}

function Harness() {
  return (
    <Routes>
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/auth" element={<div>Sign-in destination</div>} />
    </Routes>
  )
}

beforeEach(() => {
  vi.mocked(getBillingPlans).mockResolvedValue(plans)
  vi.mocked(createCheckoutSession).mockResolvedValue({ url: "https://checkout.stripe.com/test" })
})
afterEach(() => vi.clearAllMocks())

describe("PricingPage", () => {
  it("renders only the configured existing-feature comparison", async () => {
    renderWithProviders(<Harness />, { initialEntries: ["/pricing"] })
    expect(await screen.findByRole("heading", { name: /simple plans/i })).toBeInTheDocument()
    expect(screen.getByText("$12")).toBeInTheDocument()
    expect(screen.getByText("Create and edit invoices")).toBeInTheDocument()
    expect(screen.getByText("AI-assisted drafting and edits")).toBeInTheDocument()
    expect(screen.queryByText(/payment tracking|monthly revenue|overdue/i)).not.toBeInTheDocument()
  })

  it("sends a signed-out visitor to authentication before checkout", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />, { auth: { user: null }, initialEntries: ["/pricing"] })
    await screen.findByText("$12")
    await user.click(screen.getByRole("button", { name: /choose pro monthly/i }))
    expect(await screen.findByText("Sign-in destination")).toBeInTheDocument()
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })

  it("creates a server checkout session for a signed-in user", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />, { initialEntries: ["/pricing"] })
    await screen.findByText("$12")
    await user.click(screen.getByRole("button", { name: /choose pro monthly/i }))
    expect(createCheckoutSession).toHaveBeenCalledTimes(1)
    expect(createCheckoutSession).toHaveBeenCalledWith("month")
    expect(redirectToStripe).toHaveBeenCalledWith("https://checkout.stripe.com/test")
  })

  it("disables paid checkout when Stripe is not configured", async () => {
    vi.mocked(getBillingPlans).mockResolvedValue({ ...plans, configured: false })
    renderWithProviders(<Harness />, { initialEntries: ["/pricing"] })
    const button = await screen.findByRole("button", { name: /billing setup required/i })
    expect(button).toBeDisabled()
    expect(screen.getByText(/not configured yet/i)).toBeInTheDocument()
  })
})
