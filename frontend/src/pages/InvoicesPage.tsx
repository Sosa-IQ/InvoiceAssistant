import { useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Upload, FileText, CheckCircle, XCircle, Loader2, Eye, Trash2, Pencil, Mail, Download, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
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
import { ProUpgradeDialog } from "@/components/ProUpgradeDialog"
import { useEmailAllowance } from "@/hooks/useEmailAllowance"
import {
  deleteInvoice,
  downloadInvoicePdf,
  listInvoices,
  openInvoicePdf,
  updateInvoiceStatus,
  uploadInvoices,
} from "@/api/invoices"
import type { InvoiceData, InvoiceRecord } from "@/types/invoice"
import {
  filterOptions,
  filterRecords,
  NO_FILTERS,
  sortRecords,
  type HistoryFilters,
  type SortKey,
  type SortState,
} from "@/lib/invoiceHistory"

const LIFECYCLE = new Set(["drafted", "sent", "paid"])

const STATUS_COLORS: Record<string, string> = {
  drafted: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100",
  sent: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  paid: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100",
  processing: "bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-100",
  parse_failed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
  stored: "bg-muted text-foreground",
  // legacy values still visible until migration backfill
  exported: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  indexed: "bg-muted text-foreground",
  draft: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100",
}

function displayStatus(status: string) {
  if (status === "exported" || status === "draft" || status === "indexed") return "drafted"
  return status
}

function canView(r: InvoiceRecord) {
  return !["processing", "parse_failed"].includes(r.status)
}

function canEmail(r: InvoiceRecord) {
  if (r.source !== "generated" || !r.invoice_json) return false
  const s = displayStatus(r.status)
  return LIFECYCLE.has(s) || r.status === "exported"
}

function fmt(val: number | null, currency = "USD") {
  if (val == null) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(val)
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string
  sortKey: SortKey
  sort: SortState
  onSort: (key: SortKey) => void
  align?: "left" | "right"
}) {
  const active = sort.key === sortKey
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown
  return (
    <TableHead
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={align === "right" ? "text-right" : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex min-h-9 items-center gap-1 rounded-md font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          active ? "text-foreground" : ""
        }`}
      >
        {label}
        <Icon aria-hidden="true" className={`h-3.5 w-3.5 ${active ? "" : "opacity-40"}`} />
      </button>
    </TableHead>
  )
}

export default function InvoicesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [viewingId, setViewingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [statusUpdatingId, setStatusUpdatingId] = useState<number | null>(null)
  const [sendDialogRecord, setSendDialogRecord] = useState<InvoiceRecord | null>(null)
  const [proUpgradeOpen, setProUpgradeOpen] = useState(false)
  const { canEmail: hasEmailAllowance } = useEmailAllowance()
  const [downloadingId, setDownloadingId] = useState<number | null>(null)
  const [sort, setSort] = useState<SortState>({ key: "issue_date", dir: "desc" })
  const [filters, setFilters] = useState<HistoryFilters>(NO_FILTERS)

  const { data: records = [], isLoading, isError, refetch } = useQuery<InvoiceRecord[]>({
    queryKey: ["invoices"],
    queryFn: listInvoices,
  })
  const options = useMemo(() => filterOptions(records), [records])
  const visible = useMemo(() => sortRecords(filterRecords(records, filters), sort), [records, filters, sort])
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS)

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "issue_date" || key === "grand_total" ? "desc" : "asc" },
    )
  }

  async function handleDownload(r: InvoiceRecord) {
    setDownloadingId(r.id)
    try {
      const blob = await downloadInvoicePdf(r.id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = r.filename
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error("Could not download PDF.")
    } finally {
      setDownloadingId(null)
    }
  }

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

  function handleOpenSendDialog(r: InvoiceRecord) {
    if (!canEmail(r)) {
      toast.error("Save this invoice before emailing.")
      return
    }
    if (!hasEmailAllowance) {
      setProUpgradeOpen(true)
      return
    }
    setSendDialogRecord(r)
  }

  async function handleStatusChange(r: InvoiceRecord, next: "drafted" | "sent" | "paid") {
    if (r.source !== "generated") return
    if (displayStatus(r.status) === next) return
    setStatusUpdatingId(r.id)
    try {
      await updateInvoiceStatus(r.id, next)
      toast.success(`Status set to ${next}.`)
      queryClient.invalidateQueries({ queryKey: ["invoices"] })
    } catch {
      toast.error("Could not update status.")
    } finally {
      setStatusUpdatingId(null)
    }
  }

  function StatusControl({ r }: { r: InvoiceRecord }) {
    const label = displayStatus(r.status)
    if (r.source === "generated" && (LIFECYCLE.has(label) || r.status === "exported" || r.status === "draft" || r.status === "indexed")) {
      return (
        <div className="inline-flex items-center gap-1.5">
          <label className="sr-only" htmlFor={`status-${r.id}`}>
            Invoice status
          </label>
          <select
            id={`status-${r.id}`}
            className={`min-h-9 rounded-full border-0 px-2.5 py-1 text-xs font-bold capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${STATUS_COLORS[label] ?? "bg-muted text-foreground"}`}
            value={label === "exported" || label === "draft" || label === "indexed" ? "drafted" : label}
            disabled={statusUpdatingId === r.id}
            onChange={(e) => void handleStatusChange(r, e.target.value as "drafted" | "sent" | "paid")}
          >
            <option value="drafted">drafted</option>
            <option value="sent">sent</option>
            <option value="paid">paid</option>
          </select>
          {statusUpdatingId === r.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
      )
    }
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold capitalize ${STATUS_COLORS[r.status] ?? "bg-muted text-foreground"}`}>
        {r.status === "parse_failed" && <XCircle className="h-3 w-3" />}
        {r.status === "processing" && <Loader2 className="h-3 w-3 animate-spin" />}
        {(r.status === "stored" || r.status === "indexed") && <CheckCircle className="h-3 w-3" />}
        {r.status === "stored" || r.status === "indexed" ? "imported" : r.status}
      </span>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Invoices</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create a new invoice or open work you already saved.</p>
        </div>
        <Button className="min-h-12 w-full rounded-xl sm:w-auto" onClick={() => navigate("/invoices/new")}>
          New invoice
        </Button>
      </div>

      <div
        className={`cursor-pointer rounded-[24px] border-2 border-dashed bg-card p-7 text-center shadow-sm transition-colors sm:p-10 ${
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/60"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
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
            <p className="text-sm">Uploading…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Upload className="h-8 w-8" />
            <p className="text-sm">Drop PDFs here or click to select</p>
            <p className="text-xs">Multiple files supported</p>
          </div>
        )}
      </div>

      <div className="rounded-[24px] border bg-card p-4 shadow-sm sm:p-6">
        <h2 className="mb-4 text-sm font-black uppercase tracking-[0.12em] text-muted-foreground">
          History ({filtersActive ? `${visible.length} of ${records.length}` : records.length})
        </h2>
        {records.length > 0 && (
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto] lg:items-end">
            <div className="space-y-1">
              <label htmlFor="filter-client" className="text-xs font-medium text-muted-foreground">Client</label>
              <select id="filter-client" value={filters.client} onChange={(e) => setFilters((f) => ({ ...f, client: e.target.value }))} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">All clients</option>
                {options.clients.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="filter-status" className="text-xs font-medium text-muted-foreground">Status</label>
              <select id="filter-status" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm capitalize">
                <option value="">All statuses</option>
                {options.statuses.map((st) => <option key={st} value={st}>{st.replace("_", " ")}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="filter-from" className="text-xs font-medium text-muted-foreground">From</label>
              <input id="filter-from" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" />
            </div>
            <div className="space-y-1">
              <label htmlFor="filter-to" className="text-xs font-medium text-muted-foreground">To</label>
              <input id="filter-to" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" />
            </div>
            <Button type="button" variant="ghost" className="h-10" disabled={!filtersActive} onClick={() => setFilters(NO_FILTERS)}>
              Clear filters
            </Button>
            <div className="space-y-1 md:hidden">
              <label htmlFor="sort-mobile" className="text-xs font-medium text-muted-foreground">Sort by</label>
              <select
                id="sort-mobile"
                value={`${sort.key}:${sort.dir}`}
                onChange={(e) => {
                  const [key, dir] = e.target.value.split(":") as [SortKey, "asc" | "desc"]
                  setSort({ key, dir })
                }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="issue_date:desc">Newest first</option>
                <option value="issue_date:asc">Oldest first</option>
                <option value="grand_total:desc">Highest total</option>
                <option value="grand_total:asc">Lowest total</option>
                <option value="client_name:asc">Client A–Z</option>
                <option value="invoice_number:asc">Invoice # A–Z</option>
                <option value="status:asc">Status</option>
              </select>
            </div>
          </div>
        )}
        {isLoading ? (
          <div role="status" aria-live="polite" className="flex justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span>Loading invoices…</span>
          </div>
        ) : isError ? (
          <div role="alert" className="py-10 text-center text-sm text-destructive">
            <p>Could not load invoice history.</p>
            <Button type="button" variant="outline" className="mt-3" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : records.length > 0 && visible.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No invoices match these filters.
            <Button type="button" variant="link" onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>
          </div>
        ) : records.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <FileText className="mx-auto mb-2 h-8 w-8 opacity-40" />
            No invoices yet.
          </div>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {visible.map((r) => (
                <article key={r.id} className="rounded-2xl border bg-background/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-black">{r.invoice_number ?? r.filename}</p>
                      <p className="mt-1 truncate text-sm text-muted-foreground">{r.client_name ?? "No client name"}</p>
                    </div>
                    <StatusControl r={r} />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-muted/60 p-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Date</p>
                      <p className="mt-0.5 font-bold">{r.issue_date ?? "—"}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Total</p>
                      <p className="mt-0.5 font-black">{fmt(r.grand_total, r.currency)}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {canView(r) && (
                      <Button variant="outline" onClick={() => handleView(r)} disabled={viewingId === r.id}>
                        {viewingId === r.id ? <Loader2 className="animate-spin" /> : <Eye />} View
                      </Button>
                    )}
                    {canView(r) && (
                      <Button variant="outline" onClick={() => handleDownload(r)} disabled={downloadingId === r.id}>
                        {downloadingId === r.id ? <Loader2 className="animate-spin" /> : <Download />} Download
                      </Button>
                    )}
                    {r.source === "generated" && r.invoice_json && (
                      <Button variant="outline" onClick={() => handleEdit(r)}>
                        <Pencil /> Edit
                      </Button>
                    )}
                    {canEmail(r) && (
                      <Button variant="outline" onClick={() => handleOpenSendDialog(r)}>
                        <Mail /> Email
                      </Button>
                    )}
                    <Button variant="ghost" className="text-destructive" onClick={() => handleDelete(r)} disabled={deletingId === r.id}>
                      {deletingId === r.id ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete
                    </Button>
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHeader label="Filename" sortKey="filename" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Invoice #" sortKey="invoice_number" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Client" sortKey="client_name" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Date" sortKey="issue_date" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Total" sortKey="grand_total" sort={sort} onSort={toggleSort} align="right" />
                    <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                    <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="max-w-40 truncate font-mono text-xs">{r.filename}</TableCell>
                      <TableCell>{r.invoice_number ?? "—"}</TableCell>
                      <TableCell>{r.client_name ?? "—"}</TableCell>
                      <TableCell>{r.issue_date ?? "—"}</TableCell>
                      <TableCell className="text-right">{fmt(r.grand_total, r.currency)}</TableCell>
                      <TableCell>
                        <StatusControl r={r} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          {canView(r) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-11 w-11"
                              onClick={() => handleView(r)}
                              disabled={viewingId === r.id}
                              title="View PDF"
                            >
                              {viewingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                            </Button>
                          )}
                          {canView(r) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-11 w-11"
                              onClick={() => handleDownload(r)}
                              disabled={downloadingId === r.id}
                              title="Download PDF"
                              aria-label="Download PDF"
                            >
                              {downloadingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                            </Button>
                          )}
                          {r.source === "generated" && r.invoice_json && (
                            <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => handleEdit(r)} title="Edit invoice">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {canEmail(r) && (
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
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(r)}
                            disabled={deletingId === r.id}
                            title="Delete invoice"
                          >
                            {deletingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
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

      <EmailInvoiceDialog record={sendDialogRecord} onOpenChange={(open) => !open && setSendDialogRecord(null)} />
      <ProUpgradeDialog
        open={proUpgradeOpen}
        onOpenChange={setProUpgradeOpen}
        feature="email invoices"
        description="You've used this month's free invoice emails. Pro includes unlimited email, plus AI drafting and voice."
      />
    </div>
  )
}
