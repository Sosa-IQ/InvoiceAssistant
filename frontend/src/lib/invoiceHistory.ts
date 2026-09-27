import type { InvoiceRecord } from "@/types/invoice"

export type SortKey = "filename" | "invoice_number" | "client_name" | "issue_date" | "grand_total" | "status"
export type SortState = { key: SortKey; dir: "asc" | "desc" }

export type HistoryFilters = {
  client: string // "" = all clients
  status: string // "" = all statuses
  from: string // YYYY-MM-DD, "" = open
  to: string // YYYY-MM-DD, "" = open
}

export const NO_FILTERS: HistoryFilters = { client: "", status: "", from: "", to: "" }

/** The status word shown for a record (legacy values folded into drafted; uploads shown as imported). */
export function statusLabel(r: InvoiceRecord): string {
  if (r.source === "generated") {
    return r.status === "exported" || r.status === "draft" || r.status === "indexed" ? "drafted" : r.status
  }
  return r.status === "stored" || r.status === "indexed" ? "imported" : r.status
}

function sortValue(r: InvoiceRecord, key: SortKey): string | number | null {
  if (key === "status") return statusLabel(r)
  if (key === "grand_total") return r.grand_total
  const value = r[key]
  return value ? value.toLowerCase() : null
}

/** Sorts a copy; empty values always go last, whichever direction. */
export function sortRecords(records: InvoiceRecord[], sort: SortState): InvoiceRecord[] {
  const factor = sort.dir === "asc" ? 1 : -1
  return [...records].sort((a, b) => {
    const va = sortValue(a, sort.key)
    const vb = sortValue(b, sort.key)
    if (va === null && vb === null) return 0
    if (va === null) return 1
    if (vb === null) return -1
    if (va < vb) return -1 * factor
    if (va > vb) return 1 * factor
    return 0
  })
}

export function filterRecords(records: InvoiceRecord[], filters: HistoryFilters): InvoiceRecord[] {
  return records.filter((r) => {
    if (filters.client && (r.client_name ?? "") !== filters.client) return false
    if (filters.status && statusLabel(r) !== filters.status) return false
    if (filters.from && (!r.issue_date || r.issue_date < filters.from)) return false
    if (filters.to && (!r.issue_date || r.issue_date > filters.to)) return false
    return true
  })
}

/** Distinct, sorted values for the client and status filter menus. */
export function filterOptions(records: InvoiceRecord[]) {
  const clients = [...new Set(records.map((r) => r.client_name).filter((c): c is string => Boolean(c)))]
  const statuses = [...new Set(records.map(statusLabel))]
  return { clients: clients.sort((a, b) => a.localeCompare(b)), statuses: statuses.sort() }
}
