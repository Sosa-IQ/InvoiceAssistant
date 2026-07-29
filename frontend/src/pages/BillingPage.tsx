import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowUpRight, CheckCircle2, CreditCard, Loader2 } from "lucide-react"
import { Link, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import {
  createCheckoutSession,
  createPackCheckoutSession,
  createPortalSession,
  getBillingStatus,
  type PackKind,
} from "@/api/billing"
import AiUsageCard from "@/components/AiUsageCard"
import { Button } from "@/components/ui/button"
import PageLoading from "@/components/PageLoading"
import { redirectToStripe } from "@/lib/externalNavigation"

export default function BillingPage() {
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const statusQuery = useQuery({ queryKey: ["billing", "status"], queryFn: getBillingStatus })
  const checkout = useMutation({
    mutationFn: createCheckoutSession,
    onSuccess: ({ url }) => {
      try { redirectToStripe(url) } catch { toast.error("The billing link was invalid. Please try again.") }
    },
    onError: () => toast.error("Checkout could not be started. Please try again."),
  })
  const portal = useMutation({
    mutationFn: createPortalSession,
    onSuccess: ({ url }) => {
      try { redirectToStripe(url) } catch { toast.error("The billing link was invalid. Please try again.") }
    },
    onError: () => toast.error("The billing portal could not be opened. Please try again."),
  })
  const packCheckout = useMutation({
    mutationFn: (pack: PackKind) => createPackCheckoutSession(pack),
    onSuccess: ({ url }) => {
      try { redirectToStripe(url) } catch { toast.error("The billing link was invalid. Please try again.") }
    },
    onError: () => toast.error("Top-up checkout could not be started. Please try again."),
  })

  if (statusQuery.isPending) return <PageLoading />
  if (statusQuery.isError) {
    return (
      <div className="grid min-h-[60vh] place-items-center p-6">
        <div role="alert" className="max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold">We could not load your billing details</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Your plan has not changed. Check your connection and try again.</p>
          <Button className="mt-5 min-h-11 rounded-xl" onClick={() => void statusQuery.refetch()}>Retry</Button>
        </div>
      </div>
    )
  }

  const status = statusQuery.data
  const isPro = status.plan === "pro" && ["active", "trialing"].includes(status.status)
  const isBusy = checkout.isPending || portal.isPending || packCheckout.isPending

  if (searchParams.get("checkout") === "success" || searchParams.get("pack") === "success") {
    void queryClient.invalidateQueries({ queryKey: ["billing"] })
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.14em] text-[#e45441]">Account</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Plan and billing</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">See your current plan, AI usage, upgrade, or manage billing securely through Stripe.</p>
      </div>

      {searchParams.get("checkout") === "success" && (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-[#9dbb63] bg-[#eff8d8] p-4 text-sm text-[#274b31]">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <div><p className="font-bold">Checkout completed</p><p className="mt-1">Stripe is confirming your subscription. Refresh if the plan does not update shortly.</p></div>
        </div>
      )}
      {searchParams.get("pack") === "success" && (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-[#9dbb63] bg-[#eff8d8] p-4 text-sm text-[#274b31]">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <div><p className="font-bold">Top-up purchased</p><p className="mt-1">Your extra usage will appear after Stripe confirms payment.</p></div>
        </div>
      )}

      <section className="rounded-[24px] border bg-card p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#eff8d8] text-[#31533f]"><CreditCard className="h-6 w-6" /></span>
            <div>
              <h2 className="text-xl font-black">{isPro ? "Pro plan" : "Free plan"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">Status: <span className="font-semibold capitalize text-foreground">{status.status}</span></p>
              {status.current_period_end && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {status.cancel_at_period_end ? "Access ends" : "Current period ends"} {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(status.current_period_end))}
                </p>
              )}
              <p className="mt-2 text-sm text-muted-foreground">Pro is $12/month or $120/year. Launch promo: $9/month for your first 3 months when offered in Checkout.</p>
            </div>
          </div>

          {status.configured ? (
            isPro ? (
              <Button type="button" variant="outline" disabled={isBusy} onClick={() => portal.mutate()} className="min-h-12 rounded-xl px-5">
                {portal.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
                Manage subscription
              </Button>
            ) : (
              <Button type="button" disabled={isBusy} onClick={() => checkout.mutate()} className="min-h-12 rounded-xl bg-[#ff6b55] px-5 font-bold text-white hover:bg-[#eb5945]">
                {checkout.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Upgrade to Pro
              </Button>
            )
          ) : null}
        </div>

        {!status.configured && (
          <div className="mt-6 rounded-2xl border border-[#e4b7ad] bg-[#fff0ed] p-4">
            <p className="font-bold text-[#8d382d]">Billing is not configured yet</p>
            <p className="mt-1 text-sm leading-6 text-[#76514b]">Add the Stripe environment variables on the server before testing checkout. No subscription changes are available until then.</p>
          </div>
        )}
      </section>

      <AiUsageCard />

      {isPro && status.configured && (
        <section className="rounded-[24px] border bg-card p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-black">Usage top-ups</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Optional extras for heavy months. Top-ups only work while Pro is active. Unused balance freezes if Pro ends and returns when you resubscribe.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              className="min-h-11 rounded-xl"
              onClick={() => packCheckout.mutate("ai_tokens")}
            >
              {packCheckout.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Buy AI top-up
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              className="min-h-11 rounded-xl"
              onClick={() => packCheckout.mutate("voice_seconds")}
            >
              Buy voice top-up
            </Button>
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline" className="min-h-11 rounded-xl"><Link to="/pricing">Compare plans</Link></Button>
        <Button asChild variant="ghost" className="min-h-11 rounded-xl"><Link to="/settings">Back to settings</Link></Button>
      </div>
    </div>
  )
}
