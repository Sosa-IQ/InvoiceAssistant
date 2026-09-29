import { describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithProviders } from "@/test/utils"

vi.mock("@/api/billing", () => ({ getUsageStatus: vi.fn() }))

import { getUsageStatus } from "@/api/billing"
import AiUsageCard from "./AiUsageCard"

const usage = {
  pro_entitled: true,
  period_start: "2026-09-28T00:00:00Z",
  period_end: "2026-10-28T00:00:00Z",
  ai_tokens_included: 2_500_000,
  ai_tokens_used: 2_500_000,
  ai_tokens_pack_remaining: 1_000_000,
  ai_tokens_remaining: 1_000_000,
  ai_usage_ratio: 1,
  voice_seconds_included: 3600,
  voice_seconds_used: 3600,
  voice_seconds_pack_remaining: 3600,
  voice_seconds_remaining: 3600,
  voice_usage_ratio: 1,
  packs_frozen: false,
  ai_pack_configured: true,
  email_monthly_limit: null,
  emails_sent_this_period: 0,
}

describe("AiUsageCard", () => {
  it("counts a top-up in the bars and says how much is left", async () => {
    vi.mocked(getUsageStatus).mockResolvedValue(usage)
    renderWithProviders(<AiUsageCard />)

    expect(await screen.findByRole("progressbar", { name: /ai usage/i })).toHaveAttribute("aria-valuenow", "71")
    expect(screen.getByRole("progressbar", { name: /voice usage/i })).toHaveAttribute("aria-valuenow", "50")
    expect(screen.getByText("29% left · includes your top-up")).toBeInTheDocument()
    expect(screen.getByText("60 min left · includes your top-up")).toBeInTheDocument()
  })

  it("shows a full bar with nothing left once everything is used", async () => {
    vi.mocked(getUsageStatus).mockResolvedValue({
      ...usage,
      ai_tokens_pack_remaining: 0,
      ai_tokens_remaining: 0,
      voice_seconds_pack_remaining: 0,
      voice_seconds_remaining: 0,
    })
    renderWithProviders(<AiUsageCard />)

    expect(await screen.findByRole("progressbar", { name: /ai usage/i })).toHaveAttribute("aria-valuenow", "100")
    expect(screen.getByText("0% left")).toBeInTheDocument()
    expect(screen.getByText("No voice left")).toBeInTheDocument()
  })
})
