import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { generateInvoice } from "@/api/invoices"

const MAX_CHARS = 2000

export default function NewInvoicePage() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState("")
  const [loading, setLoading] = useState(false)

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
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New Invoice</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Describe the invoice in plain text. The AI will generate a structured draft based on your
          description and historical invoice patterns.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="prompt">Invoice Description</Label>
        <Textarea
          id="prompt"
          placeholder={`Examples:\n• 10 hours of consulting at $150/hr for Acme Corp, Net 30\n• Monthly retainer $2,500 for ABC LLC, due immediately\n• 3 website pages at $800 each for John Smith, 50% discount on first page`}
          rows={8}
          maxLength={MAX_CHARS}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="resize-none"
        />
        <p className={`text-xs text-right ${prompt.length >= MAX_CHARS ? "text-destructive" : "text-muted-foreground"}`}>
          {prompt.length} / {MAX_CHARS}
        </p>
      </div>

      <Button
        onClick={handleGenerate}
        disabled={!prompt.trim() || loading}
        className="w-full"
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
    </div>
  )
}
