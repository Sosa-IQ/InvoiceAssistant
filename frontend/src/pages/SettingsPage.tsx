import { useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useForm, useWatch } from "react-hook-form"
import { AlertCircle, AlertTriangle, ArrowRight, CreditCard, Loader2, RotateCw, Save } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DeleteAccountSection } from "@/components/DeleteAccountSection"
import { getSettings, updateSettings } from "@/api/settings"
import { apiErrorMessage } from "@/api/client"
import { CURRENCIES } from "@/lib/invoiceDefaults"
import { EMAIL_TEMPLATE_PLACEHOLDERS, unknownPlaceholders } from "@/lib/emailTemplates"
import type { BusinessSettings } from "@/types/invoice"

type SettingsFormData = Omit<BusinessSettings, "id" | "user_id" | "updated_at" | "onboarding_completed" | "onboarding_completed_at">

export default function SettingsPage() {
  const qc = useQueryClient()
  const { data, isLoading, isError, isFetching, refetch } = useQuery<BusinessSettings>({
    queryKey: ["settings"],
    queryFn: getSettings,
  })

  const { register, handleSubmit, reset, control } = useForm<SettingsFormData>()
  const [subjectTemplate, messageTemplate] = useWatch({ control, name: ["default_email_subject", "default_email_message"] })
  const unknownInTemplates = [...new Set([...unknownPlaceholders(subjectTemplate), ...unknownPlaceholders(messageTemplate)])]

  useEffect(() => {
    if (data) reset(data)
  }, [data, reset])

  const saveMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => { toast.success("Settings saved."); qc.invalidateQueries({ queryKey: ["settings"] }) },
    onError: (error) => toast.error(apiErrorMessage(error, "Failed to save settings.")),
  })

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
            <p>We couldn&apos;t load your settings. Please try again.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RotateCw className="mr-1.5 h-4 w-4" />}
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-3xl font-black tracking-tight">Settings</h1><p className="mt-1 text-sm text-muted-foreground">Your business details and invoice email defaults.</p></div>
        <Button onClick={handleSubmit((d) => saveMutation.mutate(d))} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
          Save
        </Button>
      </div>

      <form className="space-y-6" onSubmit={handleSubmit((d) => saveMutation.mutate(d))}>

        <section className="space-y-4 rounded-[24px] border bg-card p-4 shadow-sm sm:p-6">
          <h2 className="text-sm font-black uppercase tracking-[0.12em] text-muted-foreground">Business profile</h2>
          <div className="space-y-1.5"><Label>Business Name</Label><Input {...register("name")} /></div>
          <div className="space-y-1.5"><Label>Address</Label><Textarea {...register("address")} rows={2} className="resize-none" /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Email</Label><Input {...register("email")} type="email" /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input {...register("phone")} /></div>
          </div>
        </section>

        <section className="space-y-4 rounded-[24px] border bg-card p-4 shadow-sm sm:p-6">
          <h2 className="text-sm font-black uppercase tracking-[0.12em] text-muted-foreground">Invoice defaults</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="settings-currency">Currency</Label>
              <select id="settings-currency" {...register("default_currency")} className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
                {CURRENCIES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settings-tax">Default tax rate (%)</Label>
              <Input id="settings-tax" type="number" min="0" max="100" step="0.01" {...register("default_tax_pct", { valueAsNumber: true })} />
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-[24px] border bg-card p-4 shadow-sm sm:p-6">
          <h2 className="text-sm font-black uppercase tracking-[0.12em] text-muted-foreground">Email templates</h2>
          <p className="text-sm text-muted-foreground">
            Used to compose new invoice emails. Allowed placeholders:{" "}
            {EMAIL_TEMPLATE_PLACEHOLDERS.map((placeholder, index) => (
              <span key={placeholder}>
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{placeholder}</code>
                {index < EMAIL_TEMPLATE_PLACEHOLDERS.length - 1 ? ", " : ""}
              </span>
            ))}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="default-email-subject">Default Email Subject</Label>
            <Input id="default-email-subject" {...register("default_email_subject")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="default-email-message">Default Email Message</Label>
            <Textarea id="default-email-message" {...register("default_email_message")} rows={6} className="resize-y" />
          </div>
          {unknownInTemplates.length > 0 && (
            <div role="status" className="flex gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p>
                {unknownInTemplates.map((group, index) => (
                  <span key={group}>
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">{group}</code>
                    {index < unknownInTemplates.length - 1 ? ", " : " "}
                  </span>
                ))}
                {unknownInTemplates.length === 1 ? "isn't a placeholder" : "aren't placeholders"} Cuenvia fills in, so{" "}
                {unknownInTemplates.length === 1 ? "it" : "they"} will be sent exactly as typed. Check for a typo if you
                meant one of the placeholders above.
              </p>
            </div>
          )}
        </section>

        <section className="rounded-[24px] border bg-card p-4 shadow-sm sm:p-6">
          <div className="flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-secondary"><CreditCard className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="font-black">Plan and billing</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">See your plan, upgrade, or open Stripe billing.</p>
              <Button asChild variant="outline" className="mt-4"><Link to="/billing">Open billing <ArrowRight /></Link></Button>
            </div>
          </div>
        </section>

      </form>

      <DeleteAccountSection />
    </div>
  )
}
