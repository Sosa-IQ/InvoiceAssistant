import { useQuery } from "@tanstack/react-query"
import { getBillingStatus } from "@/api/billing"

/** True when the tenant has an active/trialing Pro subscription. */
export function isProStatus(plan?: string, status?: string) {
  return plan === "pro" && (status === "active" || status === "trialing")
}

/**
 * Shared Pro entitlement for UI locks.
 * Defaults to free while loading so Pro-only controls stay closed.
 */
export function useProAccess() {
  const statusQuery = useQuery({
    queryKey: ["billing", "status"],
    queryFn: getBillingStatus,
    staleTime: 30_000,
  })

  const status = statusQuery.data
  const isPro = isProStatus(status?.plan, status?.status)

  return {
    isPro,
    isLoading: statusQuery.isPending,
    configured: status?.configured ?? false,
    status,
    refetch: statusQuery.refetch,
  }
}
