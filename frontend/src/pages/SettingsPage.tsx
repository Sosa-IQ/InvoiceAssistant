import { useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { AlertCircle, Loader2, RotateCw, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { getSettings, updateSettings } from "@/api/settings"
import type { BusinessSettings } from "@/types/invoice"

type SettingsFormData = Omit<BusinessSettings, "id" | "user_id" | "updated_at">

const EMAIL_TEMPLATE_PLACEHOLDERS = [
  "{invoice_number}",
  "{client_name}",
  "{business_name}",
  "{issue_date}",
  "{total}",
  "{currency}",
]

export default function SettingsPage() {
  const qc = useQueryClient()
  const { data, isLoading, isError, isFetching, refetch } = useQuery<BusinessSettings>({
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
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Email Templates</h2>
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
        </section>

      </form>
    </div>
  )
}
