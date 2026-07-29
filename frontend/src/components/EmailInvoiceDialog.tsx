import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Eye, FileText, Loader2, Send } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/auth/AuthContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { downloadInvoicePdf, listInvoiceEmails, openInvoicePdf, sendInvoice } from "@/api/invoices"
import { getSettings } from "@/api/settings"
import type { BusinessSettings, InvoiceData, InvoiceEmail, InvoiceRecord, SendInvoiceRequest } from "@/types/invoice"

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

type DeliveryFields = {
  fromDisplayName: string
  replyToEmail: string
  recipientEmail: string
  ccEmail: string
}

type DialogView = "compose" | "confirm" | "sent"

const DELIVERY_LABELS: Record<keyof DeliveryFields, string> = {
  fromDisplayName: "From",
  replyToEmail: "Reply-To",
  recipientEmail: "Recipient",
  ccEmail: "CC",
}

function parseInvoice(record: InvoiceRecord): InvoiceData | null {
  if (!record.invoice_json) return null
  try {
    return JSON.parse(record.invoice_json) as InvoiceData
  } catch {
    return null
  }
}

// Fallback templates, used only if the tenant's saved settings are unavailable.
// These must match the backend's `DEFAULT_EMAIL_SUBJECT_TEMPLATE` /
// `DEFAULT_EMAIL_MESSAGE_TEMPLATE` in app/models/schemas.py.
const FALLBACK_SUBJECT_TEMPLATE = "Invoice {invoice_number}"
const FALLBACK_MESSAGE_TEMPLATE =
  "Hello {client_name},\n\nPlease find invoice {invoice_number} attached.\n\nBest,\n{business_name}"

// Keep in sync with the backend allowlist (EMAIL_TEMPLATE_PLACEHOLDERS in
// app/models/schemas.py). Only these named placeholders are ever substituted.
type TemplateContext = {
  invoice_number: string
  client_name: string
  business_name: string
  issue_date: string
  total: string
  currency: string
}

const TEMPLATE_PLACEHOLDER_RE = /\{([a-zA-Z0-9_]+)\}/g

function buildTemplateContext(
  record: InvoiceRecord,
  invoice: InvoiceData | null,
  settingsData: BusinessSettings | undefined,
): TemplateContext {
  return {
    invoice_number: record.invoice_number || record.filename,
    client_name: invoice?.to?.name?.trim() || record.client_name || "",
    business_name: invoice?.from?.name?.trim() || settingsData?.name?.trim() || "Invoice Assistant",
    issue_date: record.issue_date || invoice?.issue_date || "",
    total: record.grand_total != null ? record.grand_total.toFixed(2) : "",
    currency: record.currency || "",
  }
}

/** Substitutes only the explicit allowlisted placeholders above — never `eval` or a general `format_map`. */
function interpolateTemplate(template: string, context: TemplateContext): string {
  return template.replace(TEMPLATE_PLACEHOLDER_RE, (match, key: string) => (
    Object.prototype.hasOwnProperty.call(context, key) ? context[key as keyof TemplateContext] : match
  ))
}

function normalized(value: string) {
  return value.trim()
}

function newSendAttemptKey() {
  return globalThis.crypto?.randomUUID?.()
    ?? `send-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function EmailInvoiceDialog({
  record,
  onOpenChange,
}: {
  record: InvoiceRecord | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [sendSubject, setSendSubject] = useState("")
  const [sendMessage, setSendMessage] = useState("")
  const [delivery, setDelivery] = useState<DeliveryFields>({
    fromDisplayName: "",
    replyToEmail: "",
    recipientEmail: "",
    ccEmail: "",
  })
  const [baseline, setBaseline] = useState<DeliveryFields | null>(null)
  const [view, setView] = useState<DialogView>("compose")
  const [sendAttemptKey, setSendAttemptKey] = useState(newSendAttemptKey)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [sentRecipient, setSentRecipient] = useState("")
  const sentHeadingRef = useRef<HTMLHeadingElement>(null)
  const confirmHeadingRef = useRef<HTMLHeadingElement>(null)
  const composeHeadingRef = useRef<HTMLHeadingElement>(null)
  const templatedRecordIdRef = useRef<number | null>(null)

  const {
    data: emailHistory = [],
    isLoading: historyLoading,
    isError: historyError,
    refetch: refetchHistory,
  } = useQuery<InvoiceEmail[]>({
    queryKey: ["invoice-emails", record?.id],
    queryFn: () => listInvoiceEmails(record!.id),
    enabled: record !== null,
  })
  const visibleHistory = emailHistory.filter((email) => email.status === "sent")

  const settingsQuery = useQuery<BusinessSettings>({
    queryKey: ["settings"],
    queryFn: getSettings,
  })

  useEffect(() => {
    if (!record) {
      setSendSubject("")
      setSendMessage("")
      setBaseline(null)
      setView("compose")
      setSendError(null)
      return
    }
    const invoice = parseInvoice(record)
    const defaults: DeliveryFields = {
      fromDisplayName: invoice?.from?.name?.trim() || "Invoice Assistant",
      replyToEmail: invoice?.from?.email?.trim() || user?.email || "",
      recipientEmail: invoice?.to?.email?.trim() || "",
      ccEmail: user?.email || "",
    }
    setDelivery(defaults)
    setBaseline(defaults)
    setSendAttemptKey(newSendAttemptKey())
    setView("compose")
    setSendError(null)
  }, [record, user?.email])

  // Composes the subject/message once per newly opened invoice, from the
  // tenant's saved templates. Gated on `record.id` (not the `record` object,
  // which can get a new identity on unrelated refetches) so that a later
  // settings refetch while this same invoice stays open never clobbers edits
  // the user has already made.
  useEffect(() => {
    if (!record) {
      templatedRecordIdRef.current = null
      return
    }
    if (templatedRecordIdRef.current === record.id) return
    // Only compose from a *successful* settings response. On failure we do not
    // silently fall back to the built-in template; we surface an inline retry
    // instead. The built-in fallback stays valid only for a successful response
    // missing the optional template fields (legacy compatibility).
    if (!settingsQuery.isSuccess) return

    const invoice = parseInvoice(record)
    const context = buildTemplateContext(record, invoice, settingsQuery.data)
    const subjectTemplate = settingsQuery.data?.default_email_subject || FALLBACK_SUBJECT_TEMPLATE
    const messageTemplate = settingsQuery.data?.default_email_message || FALLBACK_MESSAGE_TEMPLATE
    setSendSubject(interpolateTemplate(subjectTemplate, context))
    setSendMessage(interpolateTemplate(messageTemplate, context))
    templatedRecordIdRef.current = record.id
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gate on record.id, not record identity; see comment above
  }, [record?.id, settingsQuery.data, settingsQuery.isSuccess])

  useEffect(() => {
    if (view === "sent") sentHeadingRef.current?.focus()
    if (view === "confirm") confirmHeadingRef.current?.focus()
    if (view === "compose") composeHeadingRef.current?.focus()
  }, [view])

  const changedFields = useMemo(() => {
    if (!baseline) return []
    return (Object.keys(DELIVERY_LABELS) as Array<keyof DeliveryFields>)
      .filter((key) => normalized(delivery[key]) !== normalized(baseline[key]))
  }, [baseline, delivery])

  function updateDelivery(field: keyof DeliveryFields, value: string) {
    setDelivery((current) => ({ ...current, [field]: value }))
    setSendAttemptKey(newSendAttemptKey())
    setSendError(null)
  }

  function validateComposition(): string | null {
    if (!normalized(delivery.fromDisplayName)) return "From display name is required."
    if (!EMAIL_RE.test(normalized(delivery.recipientEmail))) return "Enter a valid recipient email."
    if (normalized(delivery.replyToEmail) && !EMAIL_RE.test(normalized(delivery.replyToEmail))) {
      return "Enter a valid Reply-To email."
    }
    if (normalized(delivery.ccEmail) && !EMAIL_RE.test(normalized(delivery.ccEmail))) {
      return "Enter a valid CC email."
    }
    if (!normalized(sendSubject)) return "Subject is required."
    if (!normalized(sendMessage)) return "Message is required."
    return null
  }

  function buildPayload(): SendInvoiceRequest {
    return {
      subject: normalized(sendSubject),
      message: normalized(sendMessage),
      from_display_name: normalized(delivery.fromDisplayName),
      reply_to_email: normalized(delivery.replyToEmail) || null,
      recipient_email: normalized(delivery.recipientEmail),
      cc_email: normalized(delivery.ccEmail) || null,
      idempotency_key: sendAttemptKey,
    }
  }

  async function handlePreview() {
    if (!record) return
    setPreviewing(true)
    try {
      await openInvoicePdf(record.id)
    } catch {
      toast.error("Could not open PDF.")
    } finally {
      setPreviewing(false)
    }
  }

  async function handleDownload() {
    if (!record) return
    setDownloading(true)
    try {
      const blob = await downloadInvoicePdf(record.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = record.filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error("Could not download PDF.")
    } finally {
      setDownloading(false)
    }
  }

  async function sendNow() {
    if (!record) return
    const validationError = validateComposition()
    if (validationError) {
      setSendError(validationError)
      setView("compose")
      return
    }
    setSending(true)
    setSendError(null)
    const payload = buildPayload()
    setSentRecipient(payload.recipient_email ?? "")
    try {
      await sendInvoice(record.id, payload)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["invoice-emails", record.id] }),
        queryClient.invalidateQueries({ queryKey: ["invoices"] }),
      ])
      setView("sent")
    } catch (error) {
      setView("compose")
      setSendError(error instanceof Error ? error.message : "Email send failed. Please try again.")
    } finally {
      setSending(false)
    }
  }

  function handleSend() {
    const validationError = validateComposition()
    if (validationError) {
      setSendError(validationError)
      return
    }
    if (changedFields.length > 0) {
      setView("confirm")
      return
    }
    void sendNow()
  }

  function handleOpenChange(open: boolean) {
    if (!open && sending) return
    if (!open) {
      setView("compose")
      setSendError(null)
    }
    onOpenChange(open)
  }

  function composeView() {
    return (
      <>
        <DialogHeader>
          <DialogTitle ref={composeHeadingRef} tabIndex={-1}>Email Invoice</DialogTitle>
          <DialogDescription>
            Review the delivery details, message, and PDF before sending.
          </DialogDescription>
        </DialogHeader>

        <div data-testid="dialog-scroll-body" className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="email-from">From</Label>
              <Input id="email-from" value={delivery.fromDisplayName} disabled={sending} onChange={(event) => updateDelivery("fromDisplayName", event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email-reply-to">Reply-To</Label>
              <Input id="email-reply-to" type="email" value={delivery.replyToEmail} disabled={sending} onChange={(event) => updateDelivery("replyToEmail", event.target.value)} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="email-recipient">Recipient</Label>
              <Input id="email-recipient" type="email" value={delivery.recipientEmail} disabled={sending} onChange={(event) => updateDelivery("recipientEmail", event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email-cc">CC</Label>
              <Input id="email-cc" type="email" value={delivery.ccEmail} disabled={sending} onChange={(event) => updateDelivery("ccEmail", event.target.value)} />
            </div>
          </div>

          {settingsQuery.isError && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <p>Could not load your saved email template. Subject and message aren&apos;t prefilled.</p>
              <Button type="button" variant="outline" size="sm" className="mt-2" disabled={sending || settingsQuery.isFetching} onClick={() => void settingsQuery.refetch()}>
                {settingsQuery.isFetching ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                Retry template
              </Button>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="email-subject">Subject</Label>
            <Input id="email-subject" value={sendSubject} disabled={sending} onChange={(event) => { setSendSubject(event.target.value); setSendAttemptKey(newSendAttemptKey()); setSendError(null) }} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="email-message">Message</Label>
            <Textarea
              id="email-message"
              value={sendMessage}
              disabled={sending}
              onChange={(event) => { setSendMessage(event.target.value); setSendAttemptKey(newSendAttemptKey()); setSendError(null) }}
              rows={8}
              className="resize-y"
            />
          </div>

          {sendError && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <p>{sendError}</p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void sendNow()} disabled={sending}>
                Retry Send
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={handlePreview} disabled={previewing || sending}>
              {previewing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Eye className="mr-1.5 h-4 w-4" />}
              Preview PDF
            </Button>
            <Button type="button" variant="outline" onClick={handleDownload} disabled={downloading || sending}>
              {downloading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />}
              Download PDF
            </Button>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <div className="text-sm font-medium">Send History</div>
            <div data-testid="send-history" className="max-h-56 overflow-y-auto space-y-2">
              {historyLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading history…
                </div>
              ) : historyError ? (
                <div role="alert" className="text-sm text-destructive">
                  <p>Could not load send history.</p>
                  <Button type="button" variant="outline" size="sm" className="mt-2" disabled={sending} onClick={() => void refetchHistory()}>
                    Retry history
                  </Button>
                </div>
              ) : visibleHistory.length === 0 ? (
                <div className="text-sm text-muted-foreground">No sends yet for this invoice.</div>
              ) : (
                visibleHistory.map((email) => (
                  <div key={email.id} className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{email.status}</span>
                      <span className="text-xs text-muted-foreground">
                        {email.sent_at ? new Date(email.sent_at).toLocaleString() : "Not sent"}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      To: {email.recipient_email}{email.cc_email ? ` | CC: ${email.cc_email}` : ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <DialogFooter showCloseButton={!sending}>
          <Button
            type="button"
            onClick={handleSend}
            aria-busy={sending}
            disabled={!delivery.recipientEmail.trim() || !sendSubject.trim() || !sendMessage.trim() || sending}
          >
            {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            Send Invoice
          </Button>
        </DialogFooter>
      </>
    )
  }

  function confirmView() {
    return (
      <>
        <DialogHeader>
          <DialogTitle ref={confirmHeadingRef} tabIndex={-1}>Confirm Delivery Changes</DialogTitle>
          <DialogDescription>These delivery fields differ from the saved invoice defaults:</DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <dl className="space-y-2" aria-label="Changed delivery fields">
            {changedFields.map((field) => {
              const saved = (baseline && normalized(baseline[field])) || "Not set"
              const next = normalized(delivery[field]) || "Not set"
              return (
                <div key={field} className="rounded-md border px-3 py-2 text-sm">
                  <dt className="font-medium">{DELIVERY_LABELS[field]}</dt>
                  <dd className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-muted-foreground">
                    <span className="min-w-0">
                      <span className="block text-xs font-medium uppercase tracking-wide">Saved</span>
                      <span className="block break-words text-foreground">{saved}</span>
                    </span>
                    <span aria-hidden="true">&rarr;</span>
                    <span className="min-w-0">
                      <span className="block text-xs font-medium uppercase tracking-wide">Sending</span>
                      <span className="block break-words text-foreground">{next}</span>
                    </span>
                  </dd>
                </div>
              )
            })}
          </dl>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setView("compose")} disabled={sending}>Back</Button>
          <Button type="button" onClick={() => void sendNow()} disabled={sending} aria-busy={sending}>
            {sending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Confirm and Send
          </Button>
        </DialogFooter>
      </>
    )
  }

  function sentView() {
    return (
      <>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-600" aria-hidden="true" />
          <DialogHeader className="items-center text-center sm:text-center">
            <DialogTitle ref={sentHeadingRef} tabIndex={-1}>Invoice sent</DialogTitle>
            <DialogDescription>Sent to {sentRecipient}.</DialogDescription>
          </DialogHeader>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={sending} onClick={() => { setSendAttemptKey(newSendAttemptKey()); setView("compose") }}>Send another</Button>
          <Button type="button" disabled={sending} onClick={() => handleOpenChange(false)}>Close</Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <Dialog open={record !== null} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[90dvh] flex flex-col"
        showCloseButton={!sending}
        aria-busy={sending}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          composeHeadingRef.current?.focus()
        }}
        onEscapeKeyDown={(event) => { if (sending) event.preventDefault() }}
        onPointerDownOutside={(event) => { if (sending) event.preventDefault() }}
      >
        {view === "compose" ? composeView() : view === "confirm" ? confirmView() : sentView()}
      </DialogContent>
    </Dialog>
  )
}
