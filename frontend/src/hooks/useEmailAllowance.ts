import { useQuery } from "@tanstack/react-query"
import { getUsageStatus } from "@/api/billing"

/**
 * Invoice-email allowance: Pro is unlimited, Free gets a small monthly allowance.
 * The server enforces it; this only decides what the UI offers.
 */
export function useEmailAllowance() {
  const usageQuery = useQuery({ queryKey: ["billing", "usage"], queryFn: getUsageStatus, staleTime: 30_000 })
  const usage = usageQuery.data
  const limit = usage?.email_monthly_limit ?? null
  const used = usage?.emails_sent_this_period ?? 0
  const remaining = limit === null ? null : Math.max(0, limit - used)

  return {
    isLoading: usageQuery.isPending,
    /** True while loading so the send flow opens; the server still blocks over-limit sends. */
    canEmail: remaining === null || remaining > 0,
    limit,
    used,
    remaining,
  }
}

/** Short status line for Free accounts, or null when unlimited. */
export function freeEmailSummary(limit: number | null, remaining: number | null): string | null {
  if (limit === null || remaining === null) return null
  if (remaining === 0) return `You've used all ${limit} free invoice emails this month.`
  return `${remaining} of ${limit} free invoice emails left this month.`
}
