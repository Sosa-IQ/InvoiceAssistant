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
import type { InvoiceData, InvoiceEmail, InvoiceRecord, SendInvoiceRequest } from "@/types/invoice"

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

function buildDefaultSubject(record: InvoiceRecord, invoice: InvoiceData | null) {
  const senderName = invoice?.from?.name?.trim() || "Invoice Assistant"
  return `Invoice ${record.invoice_number || record.filename} from ${senderName}`
}

function buildDefaultMessage(record: InvoiceRecord, invoice: InvoiceData | null) {
  const recipientName = invoice?.to?.name?.trim() || record.client_name || "there"
  const senderName = invoice?.from?.name?.trim() || "our team"
  const senderEmail = invoice?.from?.email?.trim()
  return `Hi ${recipientName},

You are receiving this invoice on behalf of ${senderName}.

Please find attached invoice ${record.invoice_number || record.filename}.

Thank you,
${senderName}${senderEmail ? `\n${senderEmail}` : ""}`
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
    setSendSubject(buildDefaultSubject(record, invoice))
    setSendMessage(buildDefaultMessage(record, invoice))
    setSendAttemptKey(newSendAttemptKey())
    setView("compose")
    setSendError(null)
  }, [record, user?.email])

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
          <ul className="space-y-2" aria-label="Changed delivery fields">
            {changedFields.map((field) => (
              <li key={field} className="rounded-md border px-3 py-2 text-sm font-medium">{DELIVERY_LABELS[field]}</li>
            ))}
          </ul>
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
