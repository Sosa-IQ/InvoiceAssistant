import axios from "axios"
import { toast } from "sonner"
import { apiErrorMessage } from "@/api/client"

export type AiFeature = "ai" | "voice"
export type AiErrorKind = "usage_limit" | "rate_limit" | "unavailable" | "pro_required" | "other"

/**
 * Sort a failed AI or voice request by cause. The API only distinguishes a used-up
 * allowance from the hourly request limit by its message (both are HTTP 429).
 */
export function classifyAiError(error: unknown): AiErrorKind {
  if (!axios.isAxiosError(error)) return "other"
  const status = error.response?.status
  const detail = String(error.response?.data?.detail ?? "").toLowerCase()
  if (status === 402) return "pro_required"
  if (status === 429) return detail.includes("usage limit") ? "usage_limit" : "rate_limit"
  if (status === 503) return "unavailable"
  return "other"
}

const USAGE_TITLE: Record<AiFeature, string> = {
  ai: "You've used this month's AI",
  voice: "You've used this month's voice",
}

/** Show a plain-language toast for a failed AI or voice request. */
export function showAiError(error: unknown, feature: AiFeature, fallback: string) {
  switch (classifyAiError(error)) {
    case "pro_required":
      // The API client already shows the upgrade toast for 402.
      return
    case "usage_limit":
      toast.error(USAGE_TITLE[feature], {
        description: "Buy an AI top-up for extra AI and voice usage, or wait until your plan renews.",
        duration: 10_000,
        action: { label: "Get more usage", onClick: () => window.location.assign("/billing") },
      })
      return
    case "rate_limit":
      toast.error("Too many requests right now", {
        description:
          feature === "voice"
            ? "You've reached the hourly limit for voice notes. Please try again in a little while."
            : "You've reached the hourly limit for AI requests. Please try again in a little while.",
      })
      return
    case "unavailable":
      toast.error("AI is temporarily unavailable", {
        description: "Please try again in a few minutes. You can still edit invoices manually.",
      })
      return
    default:
      toast.error(apiErrorMessage(error, fallback))
  }
}
