import { afterEach, describe, expect, it, vi } from "vitest"
import { AxiosError, AxiosHeaders } from "axios"

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

import { toast } from "sonner"
import { classifyAiError, showAiError } from "./aiErrors"

function apiError(status: number, detail: string) {
  const headers = new AxiosHeaders()
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", { headers }, null, {
    status,
    statusText: "",
    headers,
    config: { headers },
    data: { detail },
  })
}

afterEach(() => vi.clearAllMocks())

describe("classifyAiError", () => {
  // Exact messages from backend/app/services/usage_service.py and backend/app/security.py.
  it.each([
    [429, "Monthly AI usage limit reached. Buy a top-up pack or wait until your plan renews.", "usage_limit"],
    [429, "Monthly voice usage limit reached. Upgrade usage with a top-up pack or wait until your plan renews.", "usage_limit"],
    [429, "Usage limit reached for this feature.", "usage_limit"],
    [429, "Request limit reached. Please retry later.", "rate_limit"],
    [503, "AI features are temporarily unavailable. Please try again later.", "unavailable"],
    [402, "A Pro subscription is required for this feature.", "pro_required"],
    [422, "A valid invoice could not be generated from that prompt.", "other"],
  ])("maps %s %s to %s", (status, detail, kind) => {
    expect(classifyAiError(apiError(status, detail))).toBe(kind)
  })

  it("treats non-API errors as other", () => {
    expect(classifyAiError(new Error("network"))).toBe("other")
  })
})

describe("showAiError", () => {
  it("offers more usage when the allowance is used up", () => {
    showAiError(apiError(429, "Monthly voice usage limit reached. Buy a top-up pack or wait until your plan renews."), "voice", "x")
    expect(toast.error).toHaveBeenCalledWith(
      "You've used this month's voice",
      expect.objectContaining({ action: expect.objectContaining({ label: "Get more usage" }) }),
    )
  })

  it("leaves 402 to the global upgrade toast", () => {
    showAiError(apiError(402, "A Pro subscription is required for this feature."), "ai", "x")
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("shows the server's reason, or the fallback, for other failures", () => {
    showAiError(apiError(422, "A valid invoice could not be generated from that prompt."), "ai", "fallback")
    expect(toast.error).toHaveBeenLastCalledWith("A valid invoice could not be generated from that prompt.")
    showAiError(new Error("network"), "ai", "fallback")
    expect(toast.error).toHaveBeenLastCalledWith("fallback")
  })
})
