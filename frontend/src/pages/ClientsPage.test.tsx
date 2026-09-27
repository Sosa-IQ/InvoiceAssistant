import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, vi } from "vitest"
import { renderWithProviders } from "@/test/utils"
import type { Client, InvoiceRecord } from "@/types/invoice"

vi.mock("@/api/clients", () => ({
  listClients: vi.fn(),
  createClient: vi.fn(),
  updateClient: vi.fn(),
  deleteClient: vi.fn(),
  createClientAddress: vi.fn(),
  updateClientAddress: vi.fn(),
  deleteClientAddress: vi.fn(),
}))
vi.mock("@/api/invoices", () => ({ listInvoices: vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { listClients } from "@/api/clients"
import { listInvoices } from "@/api/invoices"
import ClientsPage from "./ClientsPage"

function client(id: number, name: string, address = ""): Client {
  return {
    id, user_id: "u", name, client_code: name.slice(0, 4).toUpperCase(), email: null, phone: null, notes: null,
    addresses: address ? [{ id: id * 10, client_id: id, user_id: "u", label: null, address, created_at: null }] : [],
    created_at: null, updated_at: null,
  } as Client
}

beforeEach(() => {
  vi.mocked(listClients).mockResolvedValue([client(1, "Acme Corp", "12 Main St"), client(2, "Beta LLC", "9 Elm Rd")])
  vi.mocked(listInvoices).mockResolvedValue([
    { id: 7, client_id: 1, invoice_number: "INV-ACME_01", issue_date: "2026-08-01", grand_total: 250, currency: "USD", status: "paid", source: "generated", filename: "a.pdf" } as InvoiceRecord,
  ])
})

it("filters clients by any field, including address", async () => {
  const user = userEvent.setup()
  renderWithProviders(<ClientsPage />)
  expect(await screen.findByText("Beta LLC")).toBeInTheDocument()

  await user.type(screen.getByRole("searchbox", { name: "Search clients" }), "elm")
  expect(screen.queryByText("Acme Corp")).not.toBeInTheDocument()
  expect(screen.getByText("Beta LLC")).toBeInTheDocument()
})

it("lists a client's invoices in a collapsible section", async () => {
  const user = userEvent.setup()
  renderWithProviders(<ClientsPage />)
  const toggle = await screen.findByRole("button", { name: /invoices\s*\(1\)/i })
  expect(screen.queryByText("INV-ACME_01")).not.toBeInTheDocument()

  await user.click(toggle)
  expect(screen.getByText("INV-ACME_01")).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "View all in Invoices" })).toHaveAttribute("href", "/invoices?client=Acme%20Corp")
})
