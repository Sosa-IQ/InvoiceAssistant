import { useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Upload, FileText, CheckCircle, XCircle, Loader2, Eye, BookOpen, RefreshCw, Trash2, Pencil, Mail } from "lucide-react"
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
import { EmailInvoiceDialog } from "@/components/EmailInvoiceDialog"
import {
  deleteInvoice,
  indexInvoice,
  listInvoices,
  openInvoicePdf,
  uploadInvoices,
} from "@/api/invoices"
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
  const [sendDialogRecord, setSendDialogRecord] = useState<InvoiceRecord | null>(null)

  const { data: records = [], isLoading, isError, refetch } = useQuery<InvoiceRecord[]>({
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
    const isReindex = !!r.rag_doc_id
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

  function handleOpenSendDialog(r: InvoiceRecord) {
    if (r.status !== "exported") {
      toast.error("Only exported invoices can be emailed.")
      return
    }
    setSendDialogRecord(r)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-3xl font-black tracking-tight">Invoices</h1><p className="mt-1 text-sm text-muted-foreground">Create a new invoice or open work you already saved.</p></div>
        <Button className="min-h-12 w-full rounded-xl sm:w-auto" onClick={() => navigate("/invoices/new")}>New invoice</Button>
      </div>

      {/* Drop zone */}
      <div
        className={`cursor-pointer rounded-[24px] border-2 border-dashed bg-card p-7 text-center shadow-sm transition-colors sm:p-10 ${
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/60"
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
      <div className="rounded-[24px] border bg-card p-4 shadow-sm sm:p-6">
        <h2 className="mb-4 text-sm font-black uppercase tracking-[0.12em] text-muted-foreground">
          History ({records.length})
        </h2>
        {isLoading ? (
          <div role="status" aria-live="polite" className="flex justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span>Loading invoices…</span>
          </div>
        ) : isError ? (
          <div role="alert" className="py-10 text-center text-sm text-destructive">
            <p>Could not load invoice history.</p>
            <Button type="button" variant="outline" className="mt-3" onClick={() => void refetch()}>Retry</Button>
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
            No invoices yet.
          </div>
        ) : (
          <>
          <div className="space-y-3 md:hidden">
            {records.map((r) => (
              <article key={r.id} className="rounded-2xl border bg-background/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate font-black">{r.invoice_number ?? r.filename}</p><p className="mt-1 truncate text-sm text-muted-foreground">{r.client_name ?? "No client name"}</p></div>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_COLORS[r.status] ?? "bg-slate-100 text-slate-700"}`}>{r.status}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-muted/60 p-3 text-sm">
                  <div><p className="text-xs text-muted-foreground">Date</p><p className="mt-0.5 font-bold">{r.issue_date ?? "—"}</p></div>
                  <div className="text-right"><p className="text-xs text-muted-foreground">Total</p><p className="mt-0.5 font-black">{fmt(r.grand_total, r.currency)}</p></div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {VIEWABLE.has(r.status) && <Button variant="outline" onClick={() => handleView(r)} disabled={viewingId === r.id}>{viewingId === r.id ? <Loader2 className="animate-spin" /> : <Eye />} View</Button>}
                  {r.source === "generated" && r.invoice_json && <Button variant="outline" onClick={() => handleEdit(r)}><Pencil /> Edit</Button>}
                  {r.source === "generated" && r.status === "exported" && <Button variant="outline" onClick={() => handleOpenSendDialog(r)}><Mail /> Email</Button>}
                  {r.source === "generated" && <Button variant="outline" onClick={() => handleIndex(r)} disabled={!r.invoice_json || indexingId === r.id}>{indexingId === r.id ? <Loader2 className="animate-spin" /> : <BookOpen />} {r.rag_doc_id ? "Re-index" : "Train"}</Button>}
                  <Button variant="ghost" className="text-destructive" onClick={() => handleDelete(r)} disabled={deletingId === r.id}>{deletingId === r.id ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete</Button>
                </div>
              </article>
            ))}
          </div>
          <div className="hidden md:block">
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
                          className="h-11 w-11"
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
                          className="h-11 w-11"
                          onClick={() => handleEdit(r)}
                          title="Edit invoice"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}

                      {r.source === "generated" && r.status === "exported" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 text-muted-foreground"
                          onClick={() => handleOpenSendDialog(r)}
                          title="Email invoice"
                        >
                          <Mail className="h-3.5 w-3.5" />
                        </Button>
                      )}

                      {/* Index / Re-index button — only for generated invoices */}
                      {r.source === "generated" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-11 w-11 ${r.rag_doc_id ? "text-green-600 hover:text-green-700" : "text-muted-foreground"}`}
                          onClick={() => handleIndex(r)}
                          disabled={!r.invoice_json || indexingId === r.id}
                          title={
                            !r.invoice_json
                              ? "Re-export this invoice to enable indexing"
                              : r.rag_doc_id
                              ? "Re-index (already in training set)"
                              : "Add to training set"
                          }
                        >
                          {indexingId === r.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : r.rag_doc_id
                            ? <RefreshCw className="h-3.5 w-3.5" />
                            : <BookOpen className="h-3.5 w-3.5" />}
                        </Button>
                      )}

                      {/* Delete button */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 text-muted-foreground hover:text-destructive"
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
          </div>
          </>
        )}
      </div>

      <EmailInvoiceDialog
        record={sendDialogRecord}
        onOpenChange={(open) => !open && setSendDialogRecord(null)}
      />
    </div>
  )
}
