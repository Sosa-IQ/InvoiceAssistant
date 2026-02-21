import { useEffect } from "react"
import { useLocation, useNavigate, useBlocker, type BlockerFunction } from "react-router-dom"
import { useForm, useFieldArray, useWatch } from "react-hook-form"
import { Plus, Trash2, Download } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import type { InvoiceData } from "@/types/invoice"

const DRAFT_KEY = "invoice_draft"

function defaultLineItem() {
  return {
    description: "",
    quantity: 1,
    unit: "item",
    unit_price: 0,
    discount_pct: 0,
    tax_pct: 0,
    subtotal: 0,
  }
}

function calcSubtotal(qty: number, price: number, disc: number) {
  return qty * price * (1 - disc / 100)
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export default function InvoiceEditorPage() {
  const location = useLocation()
  const navigate = useNavigate()

  // Load from router state (just navigated from generate) or localStorage draft
  const initialInvoice: InvoiceData | null =
    (location.state as { invoice?: InvoiceData })?.invoice ??
    (() => {
      try {
        const raw = localStorage.getItem(DRAFT_KEY)
        return raw ? (JSON.parse(raw) as InvoiceData) : null
      } catch {
        return null
      }
    })()

  const { register, control, handleSubmit, setValue, formState: { isDirty } } =
    useForm<InvoiceData>({
      defaultValues: initialInvoice ?? {
        invoice_number: "",
        issue_date: "",
        due_date: "",
        currency: "USD",
        status: "draft",
        from: { name: null, address: null, email: null, phone: null, logo_path: null, tax_id: null },
        to: { client_id: null, name: null, address: null, email: null, phone: null },
        line_items: [defaultLineItem()],
        totals: { subtotal: 0, discount_total: 0, tax_total: 0, grand_total: 0 },
        payment_terms: "Net 30",
        notes: null,
        payment_info: { bank_name: null, account_name: null, account_number: null, routing_number: null, additional_instructions: null },
      },
    })

  const { fields, append, remove } = useFieldArray({ control, name: "line_items" })
  const lineItems = useWatch({ control, name: "line_items" }) ?? []

  // Compute live totals
  const subtotal = lineItems.reduce((s, li) => s + calcSubtotal(+li.quantity, +li.unit_price, +li.discount_pct), 0)
  const discountTotal = lineItems.reduce((s, li) => s + (+li.quantity * +li.unit_price * (+li.discount_pct / 100)), 0)
  const taxTotal = lineItems.reduce((s, li) => {
    const base = calcSubtotal(+li.quantity, +li.unit_price, +li.discount_pct)
    return s + base * (+li.tax_pct / 100)
  }, 0)
  const grandTotal = subtotal + taxTotal

  // Persist draft to localStorage on every change
  const watchedValues = useWatch({ control })
  useEffect(() => {
    if (watchedValues) {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(watchedValues)) } catch { /* ignore */ }
    }
  }, [watchedValues])

  // Warn on navigate away when dirty
  const shouldBlock: BlockerFunction = ({ currentLocation, nextLocation }) =>
    isDirty && currentLocation.pathname !== nextLocation.pathname
  const blocker = useBlocker(shouldBlock)
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (confirm("You have unsaved changes. Leave anyway?")) blocker.proceed()
      else blocker.reset()
    }
  }, [blocker])

  function clearDraft() {
    localStorage.removeItem(DRAFT_KEY)
  }

  function onExport(data: InvoiceData) {
    // Phase 4: POST /api/invoices/export
    void data
    toast.info("PDF export coming in Phase 4.")
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoice Editor</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { clearDraft(); navigate("/invoices") }}>
            Discard
          </Button>
          <Button size="sm" onClick={handleSubmit(onExport)}>
            <Download className="mr-1.5 h-4 w-4" />
            Export PDF
          </Button>
        </div>
      </div>

      <form className="space-y-6" onSubmit={handleSubmit(onExport)}>

        {/* Header info */}
        <section className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Invoice Number</Label>
            <Input {...register("invoice_number")} placeholder="INV-2026-0001" />
          </div>
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Input {...register("currency")} placeholder="USD" />
          </div>
          <div className="space-y-1.5">
            <Label>Issue Date</Label>
            <Input type="date" {...register("issue_date")} />
          </div>
          <div className="space-y-1.5">
            <Label>Due Date</Label>
            <Input type="date" {...register("due_date")} />
          </div>
          <div className="space-y-1.5">
            <Label>Payment Terms</Label>
            <Input {...register("payment_terms")} placeholder="Net 30" />
          </div>
        </section>

        <Separator />

        {/* From / To */}
        <div className="grid grid-cols-2 gap-6">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">From</h2>
            <div className="space-y-1.5"><Label>Name</Label><Input {...register("from.name")} placeholder="Your business name" /></div>
            <div className="space-y-1.5"><Label>Address</Label><Textarea {...register("from.address")} placeholder="123 Main St…" rows={2} className="resize-none" /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input {...register("from.email")} type="email" /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input {...register("from.phone")} /></div>
            <div className="space-y-1.5"><Label>Tax ID</Label><Input {...register("from.tax_id")} /></div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Bill To</h2>
            <div className="space-y-1.5"><Label>Name</Label><Input {...register("to.name")} placeholder="Client name" /></div>
            <div className="space-y-1.5"><Label>Address</Label><Textarea {...register("to.address")} placeholder="456 Client Ave…" rows={2} className="resize-none" /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input {...register("to.email")} type="email" /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input {...register("to.phone")} /></div>
          </section>
        </div>

        <Separator />

        {/* Line Items */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Line Items</h2>
            <Button type="button" variant="outline" size="sm" onClick={() => append(defaultLineItem())}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Item
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left pb-2 w-[35%]">Description</th>
                  <th className="text-right pb-2 w-[8%]">Qty</th>
                  <th className="text-left pb-2 w-[8%] pl-2">Unit</th>
                  <th className="text-right pb-2 w-[12%]">Price</th>
                  <th className="text-right pb-2 w-[8%]">Disc %</th>
                  <th className="text-right pb-2 w-[8%]">Tax %</th>
                  <th className="text-right pb-2 w-[13%]">Subtotal</th>
                  <th className="w-[6%]" />
                </tr>
              </thead>
              <tbody className="space-y-2">
                {fields.map((field, i) => {
                  const li = lineItems[i] ?? field
                  const sub = calcSubtotal(+li.quantity, +li.unit_price, +li.discount_pct)
                  return (
                    <tr key={field.id} className="border-b border-border/40">
                      <td className="py-1.5 pr-2">
                        <Input {...register(`line_items.${i}.description`)} placeholder="Description" className="h-8" />
                      </td>
                      <td className="py-1.5 pr-2">
                        <Input
                          {...register(`line_items.${i}.quantity`, { valueAsNumber: true })}
                          type="number" min={0} step="any"
                          className="h-8 text-right"
                        />
                      </td>
                      <td className="py-1.5 pr-2 pl-2">
                        <Input {...register(`line_items.${i}.unit`)} className="h-8" />
                      </td>
                      <td className="py-1.5 pr-2">
                        <Input
                          {...register(`line_items.${i}.unit_price`, { valueAsNumber: true })}
                          type="number" min={0} step="any"
                          className="h-8 text-right"
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <Input
                          {...register(`line_items.${i}.discount_pct`, { valueAsNumber: true })}
                          type="number" min={0} max={100} step="any"
                          className="h-8 text-right"
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <Input
                          {...register(`line_items.${i}.tax_pct`, { valueAsNumber: true })}
                          type="number" min={0} max={100} step="any"
                          className="h-8 text-right"
                        />
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono text-xs pt-3">{fmt(sub)}</td>
                      <td className="py-1.5 text-center">
                        <Button
                          type="button" variant="ghost" size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => remove(i)}
                          disabled={fields.length === 1}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-mono">{fmt(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Discount</span>
                <span className="font-mono text-red-600">−{fmt(discountTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax</span>
                <span className="font-mono">{fmt(taxTotal)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-semibold text-base">
                <span>Total</span>
                <span className="font-mono">{fmt(grandTotal)}</span>
              </div>
            </div>
          </div>
        </section>

        <Separator />

        {/* Notes */}
        <section className="space-y-1.5">
          <Label>Notes</Label>
          <Textarea
            {...register("notes")}
            placeholder="Payment instructions, thank you message, etc."
            rows={3}
            className="resize-none"
            onChange={(e) => setValue("notes", e.target.value || null)}
          />
        </section>

        {/* Payment Info */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Payment Info</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Bank Name</Label><Input {...register("payment_info.bank_name")} /></div>
            <div className="space-y-1.5"><Label>Account Name</Label><Input {...register("payment_info.account_name")} /></div>
            <div className="space-y-1.5"><Label>Account Number</Label><Input {...register("payment_info.account_number")} /></div>
            <div className="space-y-1.5"><Label>Routing Number</Label><Input {...register("payment_info.routing_number")} /></div>
          </div>
        </section>

      </form>
    </div>
  )
}
