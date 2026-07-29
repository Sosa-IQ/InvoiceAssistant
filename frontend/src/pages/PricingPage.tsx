import { useMutation, useQuery } from "@tanstack/react-query"
import { ArrowRight, Check, Loader2 } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { createCheckoutSession, getBillingPlans, type BillingPlan } from "@/api/billing"
import { useAuth } from "@/auth/AuthContext"
import { Button } from "@/components/ui/button"
import PageLoading from "@/components/PageLoading"
import { redirectToStripe } from "@/lib/externalNavigation"

function formatPrice(plan: BillingPlan) {
  if (plan.price_cents === 0) return "$0"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: plan.currency,
    maximumFractionDigits: plan.price_cents % 100 === 0 ? 0 : 2,
  }).format(plan.price_cents / 100)
}

export default function PricingPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const plansQuery = useQuery({ queryKey: ["billing", "plans"], queryFn: getBillingPlans })
  const checkout = useMutation({
    mutationFn: createCheckoutSession,
    onSuccess: ({ url }) => {
      try {
        redirectToStripe(url)
      } catch {
        toast.error("The billing link was invalid. Please try again.")
      }
    },
    onError: () => toast.error("Checkout could not be started. Please try again."),
  })

  if (plansQuery.isPending) return <PageLoading />
  if (plansQuery.isError) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[#f7f2e8] p-6">
        <div role="alert" className="max-w-md rounded-2xl border bg-[#fffdf8] p-6 text-center">
          <h1 className="text-xl font-bold text-[#183a32]">We could not load pricing</h1>
          <p className="mt-2 text-sm text-[#557067]">Nothing was charged. Check your connection and try again.</p>
          <Button className="mt-5 min-h-11 rounded-xl" onClick={() => void plansQuery.refetch()}>Retry</Button>
        </div>
      </div>
    )
  }

  const { configured, plans } = plansQuery.data

  function choose(plan: BillingPlan) {
    if (plan.code === "free") {
      navigate(user ? "/invoices" : "/auth")
      return
    }
    if (!user) {
      navigate("/auth", { state: { from: { pathname: "/pricing" } } })
      return
    }
    checkout.mutate()
  }

  return (
    <div className="min-h-dvh bg-[#f7f2e8] text-[#183a32]">
      <header className="border-b border-[#ded8cd] bg-[#fffdf8]/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <Link to={user ? "/invoices" : "/auth"} className="flex min-h-11 items-center gap-3 rounded-xl font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6b55]">
            <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-[14px] bg-[#ff6b55] text-sm text-white">IA</span>
            Invoice Assistant
          </Link>
          <Button asChild variant="ghost" className="min-h-11 rounded-xl">
            <Link to={user ? "/billing" : "/auth"}>{user ? "Your plan" : "Log in"}</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-black uppercase tracking-[0.16em] text-[#e45441]">Pricing</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">Simple plans. No mystery.</h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-[#557067]">
            Free covers manual invoicing and PDFs. Pro adds email, AI drafting and edits, and voice —
            $12/month or $120/year, with a launch promo of $9/month for the first 3 months when available.
          </p>
        </div>

        {!configured && (
          <p className="mx-auto mt-8 max-w-xl rounded-2xl border border-[#e4b7ad] bg-[#fff0ed] p-4 text-center text-sm font-semibold text-[#8d382d]">
            Paid billing is not configured yet. The Free plan remains available.
          </p>
        )}

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {plans.map((plan) => {
            const isPro = plan.code === "pro"
            return (
              <section key={plan.code} className={`flex min-w-0 flex-col rounded-[28px] border p-6 shadow-[0_16px_45px_rgba(24,58,50,0.07)] sm:p-8 ${isPro ? "border-[#9dbb63] bg-[#eff8d8]" : "border-[#ded8cd] bg-[#fffdf8]"}`}>
                <div>
                  <p className="text-sm font-black uppercase tracking-[0.14em] text-[#557067]">{plan.name}</p>
                  <p className="mt-3 flex items-end gap-2">
                    <span className="text-5xl font-black tracking-tight">{formatPrice(plan)}</span>
                    <span className="pb-1 text-sm text-[#557067]">/{plan.interval}</span>
                  </p>
                </div>
                <ul className="mt-7 flex-1 space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm leading-6">
                      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#b8dc72] text-[#183a32]"><Check className="h-3.5 w-3.5" /></span>
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  disabled={(isPro && !configured) || checkout.isPending}
                  onClick={() => choose(plan)}
                  className={`mt-8 min-h-12 w-full rounded-xl font-black ${isPro ? "bg-[#183a32] text-white hover:bg-[#264d43]" : "bg-[#ff6b55] text-white hover:bg-[#eb5945]"}`}
                >
                  {checkout.isPending && isPro ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {isPro ? (configured ? "Choose Pro" : "Billing setup required") : "Start with Free"}
                  {(!checkout.isPending || !isPro) && <ArrowRight className="h-4 w-4" />}
                </Button>
              </section>
            )
          })}
        </div>

        <p className="mt-8 text-center text-xs leading-5 text-[#6d807a]">
          Plan enforcement stays off until billing is configured and explicitly enabled by the operator.
        </p>
      </main>
    </div>
  )
}
