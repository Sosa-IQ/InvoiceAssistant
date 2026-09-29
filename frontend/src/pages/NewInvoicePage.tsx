import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { FilePenLine, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { ProLockedPanel } from "@/components/ProLockedPanel"
import { UsageLimitPanel } from "@/components/UsageLimitPanel"
import { createInvoiceDraft, generateInvoice } from "@/api/invoices"
import { VoiceRecorder } from "@/components/VoiceRecorder"
import { useProAccess } from "@/hooks/useProAccess"
import { USAGE_QUERY_KEY, useAiAllowance } from "@/hooks/useAiAllowance"

const MAX_CHARS = 8000
const DRAFT_KEY = "invoice_draft"

export default function NewInvoicePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isPro, isLoading: proLoading } = useProAccess()
  const { aiExhausted, voiceExhausted, canBuyTopUp, periodEnd } = useAiAllowance()
  const [prompt, setPrompt] = useState("")
  const [loading, setLoading] = useState(false)
  const [manualLoading, setManualLoading] = useState(false)
  // True while the voice recorder is recording or transcribing.
  const [voiceBusy, setVoiceBusy] = useState(false)

  // ── Generate ─────────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!prompt.trim()) return
    setLoading(true)
    try {
      const result = await generateInvoice(prompt.trim())
      toast.success(
        `Invoice generated${result.rag_docs_used > 0 ? ` using ${result.rag_docs_used} historical doc(s)` : ""}.`
      )
      navigate("/invoices/editor", { state: { invoice: result.invoice } })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Generation failed."
      toast.error(msg)
    } finally {
      setLoading(false)
      void queryClient.invalidateQueries({ queryKey: USAGE_QUERY_KEY })
    }
  }

  async function handleCreateManually() {
    setManualLoading(true)
    try {
      const invoice = await createInvoiceDraft()
      localStorage.removeItem(DRAFT_KEY)
      navigate("/invoices/editor", { state: { invoice } })
    } catch {
      toast.error("Could not create a manual invoice draft.")
    } finally {
      setManualLoading(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-3xl font-black tracking-tight">New invoice</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          {isPro && aiExhausted
            ? "You can still create a blank invoice manually while AI is paused."
            : isPro
            ? "Tell us what you are billing for. Type it, say it aloud, or start with a blank invoice."
            : "Create a blank invoice manually on Free. AI drafting and voice are included with Pro."}
        </p>
      </div>

      {!proLoading && isPro && aiExhausted ? (
        <UsageLimitPanel kind="ai" periodEnd={periodEnd} canBuyTopUp={canBuyTopUp} />
      ) : !proLoading && isPro ? (
        <>
          {voiceExhausted ? (
            <UsageLimitPanel kind="voice" periodEnd={periodEnd} canBuyTopUp={canBuyTopUp} />
          ) : (
            <div className="rounded-[24px] border bg-card p-6 shadow-sm sm:p-8">
              <VoiceRecorder
                disabled={loading || manualLoading}
                onBusyChange={setVoiceBusy}
                onTranscript={(transcript) => setPrompt((prev) => (prev ? `${prev}\n${transcript}` : transcript))}
              />
            </div>
          )}

          {/* Prompt textarea */}
          <div className="space-y-2 rounded-[24px] border bg-card p-4 shadow-sm sm:p-6">
            <Label htmlFor="prompt">Invoice Description</Label>
            <Textarea
              id="prompt"
              placeholder={`Examples:\n• 10 hours of consulting at $150/hr for Acme Corp\n• Monthly retainer $2,500 for ABC LLC\n• 3 website pages at $800 each for John Smith`}
              rows={8}
              maxLength={MAX_CHARS}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-48 resize-none rounded-xl bg-background/40 text-base leading-6"
            />
            <p className={`text-xs text-right ${prompt.length >= MAX_CHARS ? "text-destructive" : "text-muted-foreground"}`}>
              {prompt.length} / {MAX_CHARS}
            </p>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={!prompt.trim() || loading || manualLoading}
            className="min-h-12 w-full rounded-xl"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate Invoice
              </>
            )}
          </Button>
        </>
      ) : !proLoading ? (
        <ProLockedPanel
          title="AI drafting and voice"
          feature="AI drafting and voice"
          description="Describe the work in plain language or record a quick voice note. Cuenvia fills in a draft you can edit — included with Pro."
        />
      ) : (
        <div className="rounded-[24px] border bg-card p-6 text-sm text-muted-foreground shadow-sm">Checking plan…</div>
      )}

      <Button
        onClick={handleCreateManually}
        disabled={loading || manualLoading || voiceBusy}
        className="min-h-12 w-full rounded-xl"
        size="lg"
        variant={isPro && !aiExhausted ? "outline" : "default"}
      >
        {manualLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Creating…
          </>
        ) : (
          <>
            <FilePenLine className="mr-2 h-4 w-4" />
            Create Manually
          </>
        )}
      </Button>
    </div>
  )
}
