import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithProviders } from "@/test/utils"

vi.mock("@/api/billing", () => ({
  getBillingStatus: vi.fn(),
  getUsageStatus: vi.fn(),
  createPackCheckoutSession: vi.fn(),
  createCheckoutSession: vi.fn(),
}))
vi.mock("@/api/invoices", () => ({ createInvoiceDraft: vi.fn(), generateInvoice: vi.fn() }))
vi.mock("@/api/voice", () => ({ transcribeAudio: vi.fn() }))
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}))
vi.mock("@/lib/externalNavigation", () => ({ redirectToStripe: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { createPackCheckoutSession, getBillingStatus, getUsageStatus } from "@/api/billing"
import { createInvoiceDraft } from "@/api/invoices"
import { redirectToStripe } from "@/lib/externalNavigation"
import NewInvoicePage from "./NewInvoicePage"

const proStatus = {
  plan: "pro",
  status: "active",
  stripe_customer_id: "cus_1",
  stripe_subscription_id: "sub_1",
  stripe_price_id: "price_pro",
  current_period_end: "2026-10-28T00:00:00Z",
  cancel_at_period_end: false,
  configured: true,
  enforcement_enabled: true,
} as const

const proUsage = {
  pro_entitled: true,
  period_start: "2026-09-28T00:00:00Z",
  period_end: "2026-10-28T00:00:00Z",
  ai_tokens_included: 2_500_000,
  ai_tokens_used: 0,
  ai_tokens_pack_remaining: 0,
  ai_tokens_remaining: 2_500_000,
  ai_usage_ratio: 0,
  voice_seconds_included: 3600,
  voice_seconds_used: 0,
  voice_seconds_pack_remaining: 0,
  voice_seconds_remaining: 3600,
  voice_usage_ratio: 0,
  packs_frozen: false,
  ai_pack_configured: true,
  email_monthly_limit: null,
  emails_sent_this_period: 0,
}

beforeEach(() => {
  vi.mocked(getBillingStatus).mockResolvedValue(proStatus)
  vi.mocked(getUsageStatus).mockResolvedValue(proUsage)
  vi.mocked(createPackCheckoutSession).mockResolvedValue({ url: "https://checkout.stripe.com/pack" })
})
afterEach(() => vi.clearAllMocks())

describe("NewInvoicePage usage limits", () => {
  it("replaces AI and voice with a top-up offer when AI is used up", async () => {
    vi.mocked(getUsageStatus).mockResolvedValue({ ...proUsage, ai_tokens_used: 2_500_000, ai_tokens_remaining: 0 })
    const user = userEvent.setup()
    renderWithProviders(<NewInvoicePage />)

    expect(await screen.findByText(/you've used this month's ai/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /generate invoice/i })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /create manually/i })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /buy ai top-up/i }))
    expect(createPackCheckoutSession).toHaveBeenCalledWith("ai_topup")
    expect(redirectToStripe).toHaveBeenCalledWith("https://checkout.stripe.com/pack")
  })

  it("pauses only voice when voice is used up", async () => {
    vi.mocked(getUsageStatus).mockResolvedValue({ ...proUsage, voice_seconds_used: 3600, voice_seconds_remaining: 0 })
    renderWithProviders(<NewInvoicePage />)

    expect(await screen.findByText(/you've used this month's voice/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/invoice description/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /generate invoice/i })).toBeInTheDocument()
  })

  it("keeps features open when the server is not enforcing limits", async () => {
    vi.mocked(getBillingStatus).mockResolvedValue({ ...proStatus, enforcement_enabled: false })
    vi.mocked(getUsageStatus).mockResolvedValue({ ...proUsage, ai_tokens_remaining: 0, voice_seconds_remaining: 0 })
    renderWithProviders(<NewInvoicePage />)

    expect(await screen.findByRole("button", { name: /generate invoice/i })).toBeInTheDocument()
    expect(screen.queryByText(/usage limit reached/i)).not.toBeInTheDocument()
  })
})

describe("NewInvoicePage manual create", () => {
  beforeEach(() => {
    vi.mocked(createInvoiceDraft).mockResolvedValue({} as Awaited<ReturnType<typeof createInvoiceDraft>>)
  })

  it("asks before discarding a typed description", async () => {
    const user = userEvent.setup()
    renderWithProviders(<NewInvoicePage />)
    await user.type(await screen.findByLabelText(/invoice description/i), "3 hours of consulting")

    await user.click(screen.getByRole("button", { name: /create manually/i }))
    expect(screen.getByRole("dialog", { name: /start a blank invoice instead/i })).toBeInTheDocument()
    expect(createInvoiceDraft).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: /go back/i }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByLabelText(/invoice description/i)).toHaveValue("3 hours of consulting")
    expect(createInvoiceDraft).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: /create manually/i }))
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /create manually/i }))
    expect(createInvoiceDraft).toHaveBeenCalledTimes(1)
  })

  it("creates right away when the description is empty", async () => {
    const user = userEvent.setup()
    renderWithProviders(<NewInvoicePage />)
    await screen.findByLabelText(/invoice description/i)

    await user.click(screen.getByRole("button", { name: /create manually/i }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(createInvoiceDraft).toHaveBeenCalledTimes(1)
  })
})
