import { useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { ArrowRight, Check, Loader2 } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { createCheckoutSession, getBillingPlans, type BillingPlan } from "@/api/billing"
import { useAuth } from "@/auth/AuthContext"
import { Button } from "@/components/ui/button"
import PageLoading from "@/components/PageLoading"
import {
  LAUNCH_PROMO_BLURB,
  LAUNCH_PROMO_SHORT,
} from "@/lib/brand"
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
  const [proInterval, setProInterval] = useState<"month" | "year">("month")
  const plansQuery = useQuery({ queryKey: ["billing", "plans"], queryFn: getBillingPlans })
  const checkout = useMutation({
    mutationFn: (interval: "month" | "year") => createCheckoutSession(interval),
    onSuccess: ({ url }) => {
      try {
        redirectToStripe(url)
      } catch {
        toast.error("The billing link was invalid. Please try again.")
      }
    },
    onError: () => toast.error("Checkout could not be started. Please try again."),
  })

  const { freePlan, proMonthly, proYearly } = useMemo(() => {
    const list = plansQuery.data?.plans ?? []
    return {
      freePlan: list.find((p) => p.code === "free") ?? null,
      proMonthly: list.find((p) => p.code === "pro" && p.interval === "month") ?? null,
      proYearly: list.find((p) => p.code === "pro" && p.interval === "year") ?? null,
    }
  }, [plansQuery.data])

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

  const { configured } = plansQuery.data
  const hasYearly = Boolean(proYearly)
  const selectedPro = proInterval === "year" && proYearly ? proYearly : proMonthly
  const proFeatures = selectedPro?.features ?? proMonthly?.features ?? []

  function chooseFree() {
    navigate(user ? "/invoices" : "/auth")
  }

  function choosePro() {
    if (!user) {
      navigate("/auth", { state: { from: { pathname: "/pricing" } } })
      return
    }
    const interval = proInterval === "year" && hasYearly ? "year" : "month"
    checkout.mutate(interval)
  }

  return (
    <div className="min-h-dvh bg-[#f7f2e8] text-[#183a32]">
      <header className="border-b border-[#ded8cd] bg-[#fffdf8]/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <Link
            to="/"
            className="flex min-h-11 items-center gap-3 rounded-xl font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6b55]"
          >
            <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-[14px] bg-[#ff6b55] text-sm text-white">
              C
            </span>
            Cuenvia
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
            Free covers manual invoicing and PDFs. Pro adds email, AI drafting and edits, and voice.
          </p>
        </div>

        <div className="mx-auto mt-8 max-w-xl rounded-[24px] border border-[#9dbb63] bg-[#eff8d8] px-5 py-4 text-center shadow-sm">
          <p className="text-sm font-black text-[#274b31]">{LAUNCH_PROMO_SHORT}</p>
          <p className="mt-1 text-sm leading-6 text-[#31533f]">{LAUNCH_PROMO_BLURB}</p>
        </div>

        {!configured && (
          <p className="mx-auto mt-8 max-w-xl rounded-2xl border border-[#e4b7ad] bg-[#fff0ed] p-4 text-center text-sm font-semibold text-[#8d382d]">
            Paid billing is not configured yet. The Free plan remains available.
          </p>
        )}

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {freePlan && (
            <section className="flex min-w-0 flex-col rounded-[28px] border border-[#ded8cd] bg-[#fffdf8] p-6 shadow-[0_16px_45px_rgba(24,58,50,0.07)] sm:p-8">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.14em] text-[#557067]">{freePlan.name}</p>
                <p className="mt-3 flex items-end gap-2">
                  <span className="text-5xl font-black tracking-tight">{formatPrice(freePlan)}</span>
                  <span className="pb-1 text-sm text-[#557067]">/month</span>
                </p>
                <p className="mt-2 text-sm text-[#557067]">No card required</p>
              </div>
              <ul className="mt-7 flex-1 space-y-3">
                {freePlan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-sm leading-6">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#b8dc72] text-[#183a32]">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                onClick={chooseFree}
                className="mt-8 min-h-12 w-full rounded-xl bg-[#ff6b55] font-black text-white hover:bg-[#eb5945]"
              >
                Start with Free
                <ArrowRight className="h-4 w-4" />
              </Button>
            </section>
          )}

          {proMonthly && (
            <section className="flex min-w-0 flex-col rounded-[28px] border border-[#9dbb63] bg-[#eff8d8] p-6 shadow-[0_16px_45px_rgba(24,58,50,0.07)] sm:p-8">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-black uppercase tracking-[0.14em] text-[#557067]">Pro</p>
                  {hasYearly && (
                    <div
                      role="group"
                      aria-label="Billing interval"
                      className="inline-flex rounded-full border border-[#9dbb63] bg-[#fffdf8] p-1 shadow-sm"
                    >
                      <button
                        type="button"
                        onClick={() => setProInterval("month")}
                        className={`min-h-9 rounded-full px-3 text-xs font-black transition ${
                          proInterval === "month"
                            ? "bg-[#183a32] text-white"
                            : "text-[#557067] hover:text-[#183a32]"
                        }`}
                      >
                        Monthly
                      </button>
                      <button
                        type="button"
                        onClick={() => setProInterval("year")}
                        className={`relative min-h-9 rounded-full px-3 text-xs font-black transition ${
                          proInterval === "year"
                            ? "bg-[#183a32] text-white shadow-sm ring-2 ring-[#ff6b55] ring-offset-2 ring-offset-[#eff8d8]"
                            : "text-[#31533f] ring-2 ring-[#ff6b55]/70 ring-offset-1 ring-offset-[#fffdf8] hover:text-[#183a32]"
                        }`}
                      >
                        Yearly
                        <span
                          className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                            proInterval === "year" ? "bg-white/20 text-white" : "bg-[#ff6b55] text-white"
                          }`}
                        >
                          Save
                        </span>
                      </button>
                    </div>
                  )}
                </div>

                {proInterval === "month" ? (
                  <>
                    <p className="mt-3 flex flex-wrap items-end gap-2">
                      <span className="text-5xl font-black tracking-tight">$9</span>
                      <span className="pb-1 text-sm text-[#557067]">/month for 3 months</span>
                    </p>
                    <p className="mt-1 text-sm text-[#557067]">
                      Then {formatPrice(proMonthly)}/month.{" "}
                      <span className="font-semibold text-[#31533f]">{LAUNCH_PROMO_SHORT}</span>
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-3 flex items-end gap-2">
                      <span className="text-5xl font-black tracking-tight">
                        {proYearly ? formatPrice(proYearly) : "$120"}
                      </span>
                      <span className="pb-1 text-sm text-[#557067]">/year</span>
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[#31533f]">Best value — 2 months free vs monthly</p>
                  </>
                )}
              </div>
              <ul className="mt-7 flex-1 space-y-3">
                {proFeatures.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-sm leading-6">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#b8dc72] text-[#183a32]">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
              {proInterval === "month" && (
                <p className="mt-4 rounded-xl border border-[#9dbb63]/60 bg-[#fffdf8]/80 px-3 py-2 text-xs leading-5 text-[#31533f]">
                  At Checkout, the launch promo is applied automatically when configured, or enter your promotion code
                  if shown.
                </p>
              )}
              <Button
                type="button"
                disabled={!configured || checkout.isPending || !selectedPro}
                onClick={choosePro}
                className="mt-8 min-h-12 w-full rounded-xl bg-[#183a32] font-black text-white hover:bg-[#264d43]"
              >
                {checkout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {configured
                  ? proInterval === "year" && hasYearly
                    ? "Choose Pro yearly"
                    : "Choose Pro monthly"
                  : "Billing setup required"}
                {(!checkout.isPending) && <ArrowRight className="h-4 w-4" />}
              </Button>
            </section>
          )}
        </div>

        <p className="mt-8 text-center text-xs leading-5 text-[#6d807a]">
          Plan enforcement stays off until billing is configured and explicitly enabled by the operator.
        </p>
      </main>
    </div>
  )
}
