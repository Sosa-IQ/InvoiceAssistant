import { useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Upload, FileText, CheckCircle, XCircle, Loader2, Eye, BookOpen, RefreshCw, Trash2, Pencil } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { listInvoices, uploadInvoices, openInvoicePdf, indexInvoice, deleteInvoice } from "@/api/invoices"
import type { InvoiceData, InvoiceRecord } from "@/types/invoice"

const STATUS_COLORS: Record<string, string> = {
  indexed: "bg-green-100 text-green-800",
  processing: "bg-yellow-100 text-yellow-800",
  parse_failed: "bg-red-100 text-red-800",
  draft: "bg-slate-100 text-slate-700",
  exported: "bg-blue-100 text-blue-800",
}

const VIEWABLE = new Set(["indexed", "exported"])

function fmt(val: number | null, currency = "USD") {
  if (val == null) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(val)
}

export default function InvoicesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [viewingId, setViewingId] = useState<number | null>(null)
  const [indexingId, setIndexingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const { data: records = [], isLoading } = useQuery<InvoiceRecord[]>({
    queryKey: ["invoices"],
    queryFn: listInvoices,
  })

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const pdfs = Array.from(files).filter((f) => f.type === "application/pdf" || f.name.endsWith(".pdf"))
    if (pdfs.length === 0) {
      toast.error("Please select PDF files only.")
      return
    }
    setUploading(true)
    try {
      const result = await uploadInvoices(pdfs)
      if (result.succeeded > 0) {
        toast.success(`${result.succeeded} invoice${result.succeeded > 1 ? "s" : ""} uploaded successfully.`)
        queryClient.invalidateQueries({ queryKey: ["invoices"] })
      }
      if (result.failed > 0) {
        result.results
          .filter((r) => !r.success)
          .forEach((r) => toast.error(`${r.filename}: ${r.error}`))
      }
    } catch {
      toast.error("Upload failed. Is the server running?")
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function handleView(r: InvoiceRecord) {
    setViewingId(r.id)
    try {
      await openInvoicePdf(r.id)
    } catch {
      toast.error("Could not open PDF.")
    } finally {
      setViewingId(null)
    }
  }

  async function handleDelete(r: InvoiceRecord) {
    if (!confirm(`Delete "${r.filename}"? This cannot be undone.`)) return
    setDeletingId(r.id)
    try {
      await deleteInvoice(r.id)
      toast.success("Invoice deleted.")
      queryClient.invalidateQueries({ queryKey: ["invoices"] })
    } catch {
      toast.error("Failed to delete invoice.")
    } finally {
      setDeletingId(null)
    }
  }

  function handleEdit(r: InvoiceRecord) {
    if (!r.invoice_json) return
    try {
      const invoice = JSON.parse(r.invoice_json) as InvoiceData
      navigate("/invoices/editor", { state: { invoice } })
    } catch {
      toast.error("Could not load invoice data.")
    }
  }

  async function handleIndex(r: InvoiceRecord) {
    const isReindex = !!r.chroma_doc_id
    setIndexingId(r.id)
    try {
      await indexInvoice(r.id)
      toast.success(isReindex ? "Invoice re-indexed." : "Invoice added to training set.")
      queryClient.invalidateQueries({ queryKey: ["invoices"] })
    } catch {
      toast.error("Indexing failed.")
    } finally {
      setIndexingId(null)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <Button onClick={() => navigate("/invoices/new")}>New Invoice</Button>
      </div>

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-10 text-center transition-colors cursor-pointer ${
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Uploading and indexing…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Upload className="h-8 w-8" />
            <p className="text-sm">Drop PDFs here or click to select</p>
            <p className="text-xs">Multiple files supported</p>
          </div>
        )}
      </div>

      {/* History table */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          History ({records.length})
        </h2>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
            No invoices yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filename</TableHead>
                <TableHead>Invoice #</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs max-w-40 truncate">{r.filename}</TableCell>
                  <TableCell>{r.invoice_number ?? "—"}</TableCell>
                  <TableCell>{r.client_name ?? "—"}</TableCell>
                  <TableCell>{r.issue_date ?? "—"}</TableCell>
                  <TableCell className="text-right">{fmt(r.grand_total, r.currency)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status] ?? "bg-slate-100 text-slate-700"}`}>
                      {r.status === "indexed" && <CheckCircle className="h-3 w-3" />}
                      {r.status === "parse_failed" && <XCircle className="h-3 w-3" />}
                      {r.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      {/* View PDF button */}
                      {VIEWABLE.has(r.status) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleView(r)}
                          disabled={viewingId === r.id}
                          title="View PDF"
                        >
                          {viewingId === r.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                      )}

                      {/* Edit button — only for generated invoices with stored JSON */}
                      {r.source === "generated" && r.invoice_json && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleEdit(r)}
                          title="Edit invoice"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}

                      {/* Index / Re-index button — only for generated invoices */}
                      {r.source === "generated" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-7 w-7 ${r.chroma_doc_id ? "text-green-600 hover:text-green-700" : "text-muted-foreground"}`}
                          onClick={() => handleIndex(r)}
                          disabled={!r.invoice_json || indexingId === r.id}
                          title={
                            !r.invoice_json
                              ? "Re-export this invoice to enable indexing"
                              : r.chroma_doc_id
                              ? "Re-index (already in training set)"
                              : "Add to training set"
                          }
                        >
                          {indexingId === r.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : r.chroma_doc_id
                            ? <RefreshCw className="h-3.5 w-3.5" />
                            : <BookOpen className="h-3.5 w-3.5" />}
                        </Button>
                      )}

                      {/* Delete button */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(r)}
                        disabled={deletingId === r.id}
                        title="Delete invoice"
                      >
                        {deletingId === r.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
