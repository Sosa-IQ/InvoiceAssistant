import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithProviders } from "@/test/utils"

vi.mock("@/api/billing", () => ({
  getBillingStatus: vi.fn(),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
}))
vi.mock("@/lib/externalNavigation", () => ({ redirectToStripe: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { createCheckoutSession, createPortalSession, getBillingStatus } from "@/api/billing"
import { redirectToStripe } from "@/lib/externalNavigation"
import BillingPage from "./BillingPage"

const freeStatus = {
  plan: "free",
  status: "free",
  stripe_customer_id: null,
  stripe_subscription_id: null,
  stripe_price_id: null,
  current_period_end: null,
  cancel_at_period_end: false,
  configured: true,
  enforcement_enabled: false,
} as const

beforeEach(() => {
  vi.mocked(getBillingStatus).mockResolvedValue(freeStatus)
  vi.mocked(createCheckoutSession).mockResolvedValue({ url: "https://checkout.stripe.com/test" })
  vi.mocked(createPortalSession).mockResolvedValue({ url: "https://billing.stripe.com/test" })
})
afterEach(() => vi.clearAllMocks())

describe("BillingPage", () => {
  it("shows current free status and starts checkout", async () => {
    const user = userEvent.setup()
    renderWithProviders(<BillingPage />)
    expect(await screen.findByText(/free plan/i)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /upgrade to pro/i }))
    expect(createCheckoutSession).toHaveBeenCalledTimes(1)
    expect(redirectToStripe).toHaveBeenCalledWith("https://checkout.stripe.com/test")
  })

  it("shows active Pro status and opens the customer portal", async () => {
    vi.mocked(getBillingStatus).mockResolvedValue({
      ...freeStatus,
      plan: "pro",
      status: "active",
      stripe_customer_id: "cus_123",
      stripe_subscription_id: "sub_123",
      current_period_end: "2027-01-15T00:00:00Z",
    })
    const user = userEvent.setup()
    renderWithProviders(<BillingPage />)
    expect(await screen.findByText(/pro plan/i)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /manage subscription/i }))
    expect(createPortalSession).toHaveBeenCalledTimes(1)
    expect(redirectToStripe).toHaveBeenCalledWith("https://billing.stripe.com/test")
  })

  it("fails closed with Retry when status cannot load", async () => {
    vi.mocked(getBillingStatus)
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue(freeStatus)
    const user = userEvent.setup()
    renderWithProviders(<BillingPage />)
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i)
    expect(screen.queryByRole("button", { name: /upgrade/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /retry/i }))
    expect(await screen.findByText(/free plan/i)).toBeInTheDocument()
  })

  it("shows configuration guidance instead of a dead checkout", async () => {
    vi.mocked(getBillingStatus).mockResolvedValue({ ...freeStatus, configured: false })
    renderWithProviders(<BillingPage />)
    expect(await screen.findByText(/billing is not configured yet/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /upgrade to pro/i })).not.toBeInTheDocument()
  })
})
