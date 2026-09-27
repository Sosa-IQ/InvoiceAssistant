import { useQuery } from "@tanstack/react-query"
import { getBillingPlans } from "@/api/billing"

/**
 * The Free plan's monthly invoice-email allowance, read from the server setting
 * (FREE_MONTHLY_EMAIL_LIMIT) so every page shows the same number. Null while loading.
 */
export function useFreeEmailLimit(): number | null {
  const plansQuery = useQuery({ queryKey: ["billing", "plans"], queryFn: getBillingPlans, staleTime: 5 * 60_000 })
  return plansQuery.data?.free_monthly_email_limit ?? null
}

/** "5 invoice emails a month", or a number-free phrase until the limit is known. */
export function freeEmailPhrase(limit: number | null): string {
  if (limit === null) return "a monthly allowance of invoice emails"
  return `${limit} invoice email${limit === 1 ? "" : "s"} a month`
}
