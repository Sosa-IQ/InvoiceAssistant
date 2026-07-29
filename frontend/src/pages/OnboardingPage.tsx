import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { getSettings, updateSettings } from "@/api/settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import PageLoading from "@/components/PageLoading"
import type { BusinessSettings } from "@/types/invoice"

const STEPS = ["Your business", "Invoice defaults", "Review"] as const
const CURRENCIES = ["USD", "CAD", "EUR", "GBP"]
const PAYMENT_TERMS = ["Due on receipt", "Net 7", "Net 15", "Net 30", "Net 45", "Net 60"]

function BrandMark() {
  return (
    <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-[14px] bg-[#ff6b55] text-base font-black text-white shadow-sm">
      IA
    </span>
  )
}

function SetupForm({ settings }: { settings: BusinessSettings }) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(0)
  const [name, setName] = useState(settings.name ?? "")
  const [email, setEmail] = useState(settings.email ?? "")
  const [phone, setPhone] = useState(settings.phone ?? "")
  const [currency, setCurrency] = useState(settings.default_currency || "USD")
  const [taxPct, setTaxPct] = useState(String(settings.default_tax_pct ?? 0))
  const [paymentTerms, setPaymentTerms] = useState(settings.payment_terms || "Net 30")
  const [validationError, setValidationError] = useState("")

  const finishMutation = useMutation({
    mutationFn: () => updateSettings({
      name: name.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      default_currency: currency,
      default_tax_pct: Number.isFinite(Number(taxPct)) ? Number(taxPct) : 0,
      payment_terms: paymentTerms,
      onboarding_completed: true,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] })
      toast.success("Your workspace is ready.")
      const destination = (location.state as { from?: string } | null)?.from ?? "/invoices"
      navigate(destination, { replace: true })
    },
    onError: () => toast.error("Setup could not be saved. Please try again."),
  })

  function continueForward() {
    if (step === 0 && !name.trim()) {
      setValidationError("Enter your business name to continue.")
      return
    }
    setValidationError("")
    setStep((current) => Math.min(current + 1, STEPS.length - 1))
  }

  return (
    <div className="min-h-dvh bg-[#f7f2e8] px-4 py-6 text-[#183a32] sm:px-6 sm:py-10">
      <main className="mx-auto w-full max-w-2xl">
        <header className="mb-8 flex items-center gap-3">
          <BrandMark />
          <div>
            <p className="text-sm font-bold">Invoice Assistant</p>
            <p className="text-xs text-[#557067]">A few simple details, then you are ready.</p>
          </div>
        </header>

        <section className="overflow-hidden rounded-[28px] border border-[#d9d4c8] bg-[#fffdf8] shadow-[0_18px_50px_rgba(24,58,50,0.08)]">
          <div className="border-b border-[#e7e1d6] px-5 py-5 sm:px-8">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="font-bold text-[#ff6b55]">Step {step + 1} of {STEPS.length}</span>
              <span className="text-[#557067]">{STEPS[step]}</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2" aria-hidden="true">
              {STEPS.map((label, index) => (
                <span key={label} className={`h-2 rounded-full ${index <= step ? "bg-[#b8dc72]" : "bg-[#e7e1d6]"}`} />
              ))}
            </div>
          </div>

          <div className="p-5 sm:p-8">
            {step === 0 && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Tell us about your business</h1>
                  <p className="mt-2 text-sm leading-6 text-[#557067]">We use this information on the invoices you create.</p>
                </div>
                {validationError && <p role="alert" className="rounded-xl bg-[#fff0ed] p-3 text-sm font-semibold text-[#a93629]">{validationError}</p>}
                <div className="space-y-2">
                  <Label htmlFor="business-name" className="text-sm font-bold">Business name</Label>
                  <Input id="business-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="organization" className="min-h-12 rounded-xl border-[#cfc9bd] bg-white text-base" />
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="business-email" className="text-sm font-bold">Business email <span className="font-normal text-[#6d807a]">(optional)</span></Label>
                    <Input id="business-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="min-h-12 rounded-xl border-[#cfc9bd] bg-white text-base" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="business-phone" className="text-sm font-bold">Phone <span className="font-normal text-[#6d807a]">(optional)</span></Label>
                    <Input id="business-phone" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" className="min-h-12 rounded-xl border-[#cfc9bd] bg-white text-base" />
                  </div>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Invoice defaults</h1>
                  <p className="mt-2 text-sm leading-6 text-[#557067]">Choose sensible starting values. You can change them later.</p>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="currency" className="text-sm font-bold">Currency</Label>
                    <select id="currency" value={currency} onChange={(event) => setCurrency(event.target.value)} className="flex min-h-12 w-full rounded-xl border border-[#cfc9bd] bg-white px-3 text-base outline-none focus:ring-2 focus:ring-[#ff6b55]">
                      {CURRENCIES.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tax-rate" className="text-sm font-bold">Default tax rate (%)</Label>
                    <Input id="tax-rate" type="number" min="0" max="100" step="0.01" value={taxPct} onChange={(event) => setTaxPct(event.target.value)} className="min-h-12 rounded-xl border-[#cfc9bd] bg-white text-base" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="payment-terms" className="text-sm font-bold">Payment terms</Label>
                  <select id="payment-terms" value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} className="flex min-h-12 w-full rounded-xl border border-[#cfc9bd] bg-white px-3 text-base outline-none focus:ring-2 focus:ring-[#ff6b55]">
                    {PAYMENT_TERMS.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Review your setup</h1>
                  <p className="mt-2 text-sm leading-6 text-[#557067]">Make sure these basics look right. Everything remains editable in Settings.</p>
                </div>
                <dl className="divide-y divide-[#e7e1d6] rounded-2xl border border-[#ded8cd] bg-white px-5">
                  <div className="py-4"><dt className="text-xs font-bold uppercase tracking-wide text-[#6d807a]">Business</dt><dd className="mt-1 font-bold">{name.trim()}</dd></div>
                  <div className="py-4"><dt className="text-xs font-bold uppercase tracking-wide text-[#6d807a]">Contact</dt><dd className="mt-1 text-sm">{email.trim() || phone.trim() || "Not provided"}</dd></div>
                  <div className="py-4"><dt className="text-xs font-bold uppercase tracking-wide text-[#6d807a]">Invoice defaults</dt><dd className="mt-1 text-sm">{currency} · {taxPct || "0"}% tax · {paymentTerms}</dd></div>
                </dl>
                {finishMutation.isError && <p role="alert" className="rounded-xl bg-[#fff0ed] p-3 text-sm font-semibold text-[#a93629]">Setup could not be saved. Your information is still here—please try again.</p>}
              </div>
            )}
          </div>

          <footer className="flex flex-col-reverse gap-3 border-t border-[#e7e1d6] bg-[#fbf8f1] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            {step > 0 ? (
              <Button type="button" variant="ghost" onClick={() => setStep((current) => current - 1)} disabled={finishMutation.isPending} className="min-h-12 rounded-xl px-5 text-[#36564e]">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
            ) : <span />}
            {step < 2 ? (
              <Button type="button" onClick={continueForward} className="min-h-12 rounded-xl bg-[#ff6b55] px-6 font-bold text-white hover:bg-[#eb5945]">
                Continue <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button type="button" onClick={() => finishMutation.mutate()} disabled={finishMutation.isPending} className="min-h-12 rounded-xl bg-[#183a32] px-6 font-bold text-white hover:bg-[#264d43]">
                {finishMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Finish setup
              </Button>
            )}
          </footer>
        </section>
      </main>
    </div>
  )
}

export default function OnboardingPage() {
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })

  if (settingsQuery.isPending) return <PageLoading />
  if (settingsQuery.isError) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[#f7f2e8] p-6">
        <div role="alert" className="max-w-md rounded-2xl border bg-[#fffdf8] p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-[#183a32]">We could not load your setup</h1>
          <p className="mt-2 text-sm leading-6 text-[#557067]">Nothing has been changed. Check your connection and try again.</p>
          <Button className="mt-5 min-h-11 rounded-xl bg-[#183a32]" onClick={() => void settingsQuery.refetch()}>Retry</Button>
        </div>
      </div>
    )
  }

  return <SetupForm settings={settingsQuery.data} />
}
