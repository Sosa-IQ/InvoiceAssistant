import type { InvoiceRecord } from "@/types/invoice"
import { filterOptions, filterRecords, sortRecords, NO_FILTERS } from "./invoiceHistory"

function rec(id: number, over: Partial<InvoiceRecord>): InvoiceRecord {
  return {
    id, user_id: "u", client_id: null, client_invoice_sequence: null, filename: `f${id}.pdf`, file_path: "",
    storage_path: null, source: "generated", invoice_number: `INV-${id}`, client_name: null, issue_date: null,
    grand_total: null, currency: "USD", rag_doc_id: null, status: "drafted", invoice_json: null, created_at: null,
    ...over,
  } as InvoiceRecord
}

const rows = [
  rec(1, { client_name: "Beta", issue_date: "2026-03-01", grand_total: 50, status: "paid" }),
  rec(2, { client_name: "acme", issue_date: "2026-01-15", grand_total: 500, status: "exported" }),
  rec(3, { client_name: null, issue_date: null, grand_total: null, source: "upload", status: "stored" }),
]

it("sorts by a column either way, with blanks last", () => {
  expect(sortRecords(rows, { key: "grand_total", dir: "desc" }).map((r) => r.id)).toEqual([2, 1, 3])
  expect(sortRecords(rows, { key: "grand_total", dir: "asc" }).map((r) => r.id)).toEqual([1, 2, 3])
  expect(sortRecords(rows, { key: "client_name", dir: "asc" }).map((r) => r.id)).toEqual([2, 1, 3])
})

it("filters by client, displayed status, and inclusive date range", () => {
  expect(filterRecords(rows, { ...NO_FILTERS, client: "Beta" }).map((r) => r.id)).toEqual([1])
  expect(filterRecords(rows, { ...NO_FILTERS, status: "drafted" }).map((r) => r.id)).toEqual([2])
  expect(filterRecords(rows, { ...NO_FILTERS, status: "imported" }).map((r) => r.id)).toEqual([3])
  expect(filterRecords(rows, { ...NO_FILTERS, from: "2026-01-15", to: "2026-02-28" }).map((r) => r.id)).toEqual([2])
})

it("lists the clients and statuses present", () => {
  expect(filterOptions(rows)).toEqual({ clients: ["acme", "Beta"], statuses: ["drafted", "imported", "paid"] })
})
