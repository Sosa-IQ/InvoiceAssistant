import { useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { getSettings, updateSettings } from "@/api/settings"
import type { BusinessSettings } from "@/types/invoice"

type SettingsFormData = Omit<BusinessSettings, "id" | "updated_at">

export default function SettingsPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<BusinessSettings>({
    queryKey: ["settings"],
    queryFn: getSettings,
  })

  const { register, handleSubmit, reset } = useForm<SettingsFormData>()

  useEffect(() => {
    if (data) reset(data)
  }, [data, reset])

  const saveMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => { toast.success("Settings saved."); qc.invalidateQueries({ queryKey: ["settings"] }) },
    onError: () => toast.error("Failed to save settings."),
  })

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Button onClick={handleSubmit((d) => saveMutation.mutate(d))} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
          Save
        </Button>
      </div>

      <form className="space-y-6" onSubmit={handleSubmit((d) => saveMutation.mutate(d))}>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Business Profile</h2>
          <div className="space-y-1.5"><Label>Business Name</Label><Input {...register("name")} /></div>
          <div className="space-y-1.5"><Label>Address</Label><Textarea {...register("address")} rows={2} className="resize-none" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Email</Label><Input {...register("email")} type="email" /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input {...register("phone")} /></div>
          </div>
          <div className="space-y-1.5"><Label>Tax ID / EIN</Label><Input {...register("tax_id")} /></div>
        </section>

        <Separator />

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Invoice Defaults</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Default Currency</Label><Input {...register("default_currency")} placeholder="USD" /></div>
            <div className="space-y-1.5">
              <Label>Default Tax %</Label>
              <Input {...register("default_tax_pct", { valueAsNumber: true })} type="number" min={0} max={100} step="0.01" />
            </div>
          </div>
          <div className="space-y-1.5"><Label>Payment Terms</Label><Input {...register("payment_terms")} placeholder="Net 30" /></div>
        </section>

        <Separator />

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Bank / Payment Info</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Bank Name</Label><Input {...register("bank_name")} /></div>
            <div className="space-y-1.5"><Label>Account Name</Label><Input {...register("account_name")} /></div>
            <div className="space-y-1.5"><Label>Account Number</Label><Input {...register("account_number")} /></div>
            <div className="space-y-1.5"><Label>Routing Number</Label><Input {...register("routing_number")} /></div>
          </div>
          <div className="space-y-1.5">
            <Label>Payment Notes</Label>
            <Textarea {...register("payment_notes")} rows={2} className="resize-none" placeholder="Additional payment instructions…" />
          </div>
        </section>

      </form>
    </div>
  )
}
