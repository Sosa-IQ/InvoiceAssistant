import { useQuery } from "@tanstack/react-query"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { getSettings } from "@/api/settings"
import { Button } from "@/components/ui/button"
import PageLoading from "@/components/PageLoading"

export default function OnboardingGate() {
  const location = useLocation()
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  })

  if (settingsQuery.isPending) return <PageLoading />

  if (settingsQuery.isError) {
    return (
      <div className="grid min-h-[60vh] place-items-center p-6">
        <div role="alert" className="max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold">We could not load your setup</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your workspace is still protected. Check your connection and try again.
          </p>
          <Button className="mt-5 min-h-11" onClick={() => void settingsQuery.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  if (!settingsQuery.data.onboarding_completed) {
    const intendedPath = `${location.pathname}${location.search}${location.hash}`
    return <Navigate replace to="/onboarding" state={{ from: intendedPath }} />
  }

  return <Outlet />
}
