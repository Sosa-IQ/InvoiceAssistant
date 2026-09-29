import { useQuery } from "@tanstack/react-query"
import { getBillingStatus, getUsageStatus } from "@/api/billing"

export const USAGE_QUERY_KEY = ["billing", "usage"] as const

/**
 * Whether a Pro account has used up its AI or voice allowance (included plus top-ups).
 * Only reports a limit when the server enforces it, and never while loading, so the
 * features stay open unless the server would actually block them.
 */
export function useAiAllowance() {
  const usageQuery = useQuery({ queryKey: USAGE_QUERY_KEY, queryFn: getUsageStatus, staleTime: 30_000 })
  const statusQuery = useQuery({ queryKey: ["billing", "status"], queryFn: getBillingStatus, staleTime: 30_000 })
  const usage = usageQuery.data
  const status = statusQuery.data
  const enforced = Boolean(status?.enforcement_enabled && usage?.pro_entitled)

  return {
    aiExhausted: enforced && (usage?.ai_tokens_remaining ?? 1) < 1,
    voiceExhausted: enforced && (usage?.voice_seconds_remaining ?? 1) < 1,
    /** True when a top-up can actually be bought right now. */
    canBuyTopUp: Boolean(status?.configured && usage?.ai_pack_configured),
    /** When the included monthly allowance resets (ISO timestamp). */
    periodEnd: usage?.period_end ?? null,
  }
}
