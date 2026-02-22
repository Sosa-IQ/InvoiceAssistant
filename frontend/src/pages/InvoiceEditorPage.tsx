import { useEffect, useRef, useState } from "react"
import { useLocation, useNavigate, useBlocker, type BlockerFunction } from "react-router-dom"
import { useForm, useFieldArray, useWatch } from "react-hook-form"
import { Plus, Trash2, Download, Loader2, GripVertical } from "lucide-react"
import { toast } from "sonner"
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { exportInvoice } from "@/api/invoices"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import type { InvoiceData } from "@/types/invoice"

const DRAFT_KEY = "invoice_draft"

function defaultLineItem() {
  return { description: "", quantity: 1, unit: "item", unit_price: 0, subtotal: 0 }
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

// ── Sortable row wrapper ──────────────────────────────────────────────────────
function SortableRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <tr
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        position: isDragging ? "relative" : undefined,
        zIndex: isDragging ? 10 : undefined,
      }}
      className="border-b border-border/40"
    >
      {/* Drag handle cell */}
      <td className="py-1.5 pr-1 w-6">
        <button
          type="button"
          className="flex items-center justify-center cursor-grab active:cursor-grabbing touch-none text-muted-foreground/30 hover:text-muted-foreground transition-colors"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </td>
      {children}
    </tr>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function InvoiceEditorPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [isExporting, setIsExporting] = useState(false)

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
        status: "draft",
        from: { name: null, address: null, email: null, phone: null, logo_path: null },
        to: { client_id: null, name: null, address: null, email: null, phone: null },
        line_items: [defaultLineItem()],
        totals: { subtotal: 0, grand_total: 0 },
        notes: null,
      },
    })

  const { fields, append, remove, move } = useFieldArray({ control, name: "line_items" })
  const lineItems = useWatch({ control, name: "line_items" }) ?? []
  const total = lineItems.reduce((s, li) => s + (+li.quantity * +li.unit_price), 0)

  // Persist draft to localStorage on every change
  const watchedValues = useWatch({ control })
  // Use a ref to avoid stale closure in the effect
  const watchedRef = useRef(watchedValues)
  watchedRef.current = watchedValues
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(watchedRef.current)) } catch { /* ignore */ }
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

  function clearDraft() { localStorage.removeItem(DRAFT_KEY) }

  async function onExport(data: InvoiceData) {
    setIsExporting(true)
    try {
      const blob = await exportInvoice(data)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${data.invoice_number || "invoice"}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      clearDraft()
      toast.success("PDF downloaded.")
    } catch {
      toast.error("Export failed. Check that the backend is running.")
    } finally {
      setIsExporting(false)
    }
  }

  // ── Drag-and-drop ──────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = fields.findIndex((f) => f.id === active.id)
    const to = fields.findIndex((f) => f.id === over.id)
    if (from !== -1 && to !== -1) move(from, to)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoice Editor</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { clearDraft(); navigate("/invoices") }}>
            Discard
          </Button>
          <Button size="sm" onClick={handleSubmit(onExport)} disabled={isExporting}>
            {isExporting
              ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              : <Download className="mr-1.5 h-4 w-4" />}
            Export PDF
          </Button>
        </div>
      </div>

      <form className="space-y-6" onSubmit={handleSubmit(onExport)}>

        {/* Header info */}
        <section className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Invoice Number</Label>
            <Input {...register("invoice_number")} placeholder="Invoice-#1" />
          </div>
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input type="date" {...register("issue_date")} />
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
                  <th className="w-6 pb-2" /> {/* drag handle */}
                  <th className="text-left pb-2 w-[38%]">Description</th>
                  <th className="text-right pb-2 w-[10%]">Qty</th>
                  <th className="text-left pb-2 w-[10%] pl-2">Unit</th>
                  <th className="text-right pb-2 w-[17%]">Unit Price</th>
                  <th className="text-right pb-2 w-[14%]">Subtotal</th>
                  <th className="w-[7%]" />
                </tr>
              </thead>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={fields.map((f) => f.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <tbody>
                    {fields.map((field, i) => {
                      const li = lineItems[i] ?? field
                      const sub = +li.quantity * +li.unit_price
                      return (
                        <SortableRow key={field.id} id={field.id}>
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
                        </SortableRow>
                      )
                    })}
                  </tbody>
                </SortableContext>
              </DndContext>
            </table>
          </div>

          {/* Total */}
          <div className="flex justify-end">
            <div className="w-48 space-y-1 text-sm">
              <Separator />
              <div className="flex justify-between font-semibold text-base">
                <span>Total</span>
                <span className="font-mono">{fmt(total)}</span>
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

      </form>
    </div>
  )
}
