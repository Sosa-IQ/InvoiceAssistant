import { useCallback, useEffect, useRef, useState } from "react"
import { useLocation, useNavigate, useBlocker, type BlockerFunction } from "react-router-dom"
import { useForm, useFieldArray, useWatch } from "react-hook-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2, Loader2, GripVertical, Save } from "lucide-react"
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
import { getNextInvoiceNumber, saveInvoice } from "@/api/invoices"
import { createClient, createClientAddress, listClients } from "@/api/clients"
import { EmailInvoiceDialog } from "@/components/EmailInvoiceDialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Client, InvoiceData, InvoiceRecord } from "@/types/invoice"

const DRAFT_KEY = "invoice_draft"
const CLIENT_ADDRESS_LABEL = "Invoice Address"

function defaultLineItem() {
  return { description: "", quantity: 1, unit: "item", unit_price: 0, subtotal: 0 }
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase()
}

function sameField(a: string | null | undefined, b: string | null | undefined) {
  return normalize(a) === normalize(b)
}

function sameContactFields(
  billTo: InvoiceData["to"] | undefined,
  client: Client,
) {
  return (
    sameField(billTo?.name, client.name) &&
    sameField(billTo?.email, client.email) &&
    sameField(billTo?.phone, client.phone)
  )
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
      <td className="py-1.5 pr-1 w-12">
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center cursor-grab active:cursor-grabbing touch-none rounded-md text-muted-foreground/50 transition-colors hover:bg-accent hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  const queryClient = useQueryClient()
  const [isSaving, setIsSaving] = useState(false)
  const [savedRecord, setSavedRecord] = useState<InvoiceRecord | null>(null)
  const [showEmailPrompt, setShowEmailPrompt] = useState(false)
  const [emailDialogRecord, setEmailDialogRecord] = useState<InvoiceRecord | null>(null)
  const suppressDraftRef = useRef(false)

  const routeInvoice = (location.state as { invoice?: InvoiceData } | null)?.invoice ?? null
  const initialInvoice: InvoiceData | null =
    routeInvoice ??
    (() => {
      try {
        const raw = localStorage.getItem(DRAFT_KEY)
        return raw ? (JSON.parse(raw) as InvoiceData) : null
      } catch {
        return null
      }
    })()

  const { register, control, handleSubmit, setValue, reset, formState: { isDirty } } =
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
  const [showClientPicker, setShowClientPicker] = useState(false)
  const [pendingClientId, setPendingClientId] = useState<number | null>(null)
  const [selectedClientSnapshot, setSelectedClientSnapshot] = useState<InvoiceData["to"] | null>(
    initialInvoice?.to.client_id ? initialInvoice.to : null,
  )

  const { fields, append, remove, move } = useFieldArray({ control, name: "line_items" })
  const billTo = useWatch({ control, name: "to" })
  const currentInvoiceNumber = useWatch({ control, name: "invoice_number" })
  const lineItems = useWatch({ control, name: "line_items" }) ?? []
  const total = lineItems.reduce((s, li) => s + (+li.quantity * +li.unit_price), 0)

  const { data: clients = [], isLoading: clientsLoading } = useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: () => listClients(),
  })
  const pendingClient = clients.find((client) => client.id === pendingClientId)
  const matchingClient = clients.find((client) => sameContactFields(billTo, client))
  const selectedClientChanged = selectedClientSnapshot
    ? !sameField(billTo?.name, selectedClientSnapshot.name) ||
      !sameField(billTo?.email, selectedClientSnapshot.email) ||
      !sameField(billTo?.phone, selectedClientSnapshot.phone) ||
      !sameField(billTo?.address, selectedClientSnapshot.address)
    : false
  const canSaveClient = Boolean(billTo?.name?.trim()) && (!billTo?.client_id || selectedClientChanged)

  // Persist draft to localStorage on every change
  const watchedValues = useWatch({ control })
  // Use a ref to avoid stale closure in the effect
  const watchedRef = useRef(watchedValues)
  watchedRef.current = watchedValues
  useEffect(() => {
    if (suppressDraftRef.current) {
      localStorage.removeItem(DRAFT_KEY)
      return
    }
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

  function closeClientPicker() {
    setShowClientPicker(false)
    setPendingClientId(null)
  }

  function toggleClientPicker() {
    setShowClientPicker((open) => {
      if (open) setPendingClientId(null)
      return !open
    })
  }

  const syncInvoiceNumber = useCallback(async (clientId: number, force = false) => {
    if (!force && currentInvoiceNumber) return
    try {
      const preview = await getNextInvoiceNumber(clientId)
      setValue("invoice_number", preview.invoice_number, { shouldDirty: true })
    } catch {
      toast.error("Could not load the next invoice number for this client.")
    }
  }, [currentInvoiceNumber, setValue])

  function setBillToClient(client: Client, address?: { id: number; address: string } | null) {
    setValue("to.client_id", client.id, { shouldDirty: true })
    setValue("to.name", client.name, { shouldDirty: true })
    setValue("to.email", client.email, { shouldDirty: true })
    setValue("to.phone", client.phone, { shouldDirty: true })

    const addressValue = address?.address ?? null
    setValue("to.address", addressValue, { shouldDirty: true })
    setSelectedClientSnapshot({
      client_id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      address: addressValue,
    })
    void syncInvoiceNumber(client.id, true)
    closeClientPicker()
  }

  function selectClient(client: Client) {
    if (client.addresses.length > 1) {
      setPendingClientId(client.id)
      return
    }

    setBillToClient(client, client.addresses[0] ?? null)
  }

  function selectAddress(client: Client, addressId: number) {
    const address = client.addresses.find((a) => a.id === addressId)
    if (address) setBillToClient(client, address)
  }

  const saveClientMutation = useMutation({
    mutationFn: async () => {
      const name = billTo?.name?.trim()
      if (!name) throw new Error("Client name is required.")
      const address = billTo?.address?.trim()
      const existingClient = matchingClient

      if (existingClient) {
        if (address && !existingClient.addresses.some((a) => sameField(a.address, address))) {
          await createClientAddress(existingClient.id, {
            label: CLIENT_ADDRESS_LABEL,
            address,
          })
        }
        return existingClient
      }

      const client = await createClient({
        name,
        email: billTo?.email?.trim() || null,
        phone: billTo?.phone?.trim() || null,
        notes: null,
      })

      if (address) {
        await createClientAddress(client.id, {
          label: CLIENT_ADDRESS_LABEL,
          address,
        })
      }

      return client
    },
    onSuccess: async (client) => {
      await queryClient.invalidateQueries({ queryKey: ["clients"] })
      setValue("to.client_id", client.id, { shouldDirty: true })
      setSelectedClientSnapshot({
        client_id: client.id,
        name: billTo?.name ?? null,
        email: billTo?.email ?? null,
        phone: billTo?.phone ?? null,
        address: billTo?.address ?? null,
      })
      await syncInvoiceNumber(client.id)
      toast.success("Client saved.")
    },
    onError: () => toast.error("Failed to save client."),
  })

  useEffect(() => {
    if (!selectedClientSnapshot || !selectedClientChanged || !billTo?.client_id) return
    setValue("to.client_id", null, { shouldDirty: true })
    setValue("invoice_number", null, { shouldDirty: true })
  }, [billTo?.client_id, selectedClientChanged, selectedClientSnapshot, setValue])

  useEffect(() => {
    if (!billTo?.client_id || currentInvoiceNumber) return
    void syncInvoiceNumber(billTo.client_id)
  }, [billTo?.client_id, currentInvoiceNumber, syncInvoiceNumber])

  async function onSave(data: InvoiceData) {
    setIsSaving(true)
    try {
      const record = await saveInvoice(data)
      const savedInvoice = record.invoice_json
        ? (JSON.parse(record.invoice_json) as InvoiceData)
        : data
      suppressDraftRef.current = true
      clearDraft()
      reset(savedInvoice)
      setSavedRecord(record)
      setShowEmailPrompt(true)
      await queryClient.invalidateQueries({ queryKey: ["invoices"] })
      toast.success("Invoice saved.")
    } catch {
      toast.error("Save failed. Select a saved client, then try again.")
    } finally {
      setIsSaving(false)
    }
  }

  function skipEmail() {
    setShowEmailPrompt(false)
    navigate("/invoices")
  }

  function openEmailDialog() {
    if (!savedRecord) return
    setShowEmailPrompt(false)
    setEmailDialogRecord(savedRecord)
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
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-3xl font-black tracking-tight">Invoice editor</h1><p className="mt-1 text-sm text-muted-foreground">Review the details before you save or export.</p></div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button variant="outline" size="sm" className="h-11" onClick={() => { clearDraft(); navigate("/invoices") }}>
            Discard
          </Button>
          <Button size="sm" className="h-11" onClick={handleSubmit(onSave)} disabled={isSaving}>
            {isSaving
              ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              : <Save className="mr-1.5 h-4 w-4" />}
            Save
          </Button>
        </div>
      </div>

      <form className="space-y-6" onSubmit={handleSubmit(onSave)}>

        {/* Header info */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Invoice Number</Label>
            <Input
              {...register("invoice_number")}
              placeholder="Assigned after selecting a saved client"
              readOnly
            />
          </div>
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input type="date" {...register("issue_date")} />
          </div>
        </section>

        <Separator />

        {/* From / To */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <section className="space-y-3">
            <div className="flex h-8 items-center">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">From</h2>
            </div>
            <div className="space-y-1.5"><Label>Name</Label><Input {...register("from.name")} placeholder="Your business name" /></div>
            <div className="space-y-1.5"><Label>Address</Label><Textarea {...register("from.address")} placeholder="123 Main St…" rows={2} className="resize-none" /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input {...register("from.email")} type="email" /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input {...register("from.phone")} /></div>
          </section>

          <section className="space-y-3">
            <div className="flex h-8 items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Bill To</h2>
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 px-3 text-xs"
                  onClick={toggleClientPicker}
                  disabled={clientsLoading || clients.length === 0}
                >
                  Saved Client
                </Button>

                {showClientPicker && (
                  <div className="absolute right-0 top-9 z-50 w-80 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
                    <div className="border-b border-border px-3 py-2">
                      {pendingClient ? (
                        <>
                          <button
                            type="button"
                            className="min-h-11 rounded-md px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-popover-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => setPendingClientId(null)}
                          >
                            Back to clients
                          </button>
                          <div className="mt-1 truncate text-sm font-medium">{pendingClient.name}</div>
                        </>
                      ) : (
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Choose Client
                        </div>
                      )}
                    </div>

                    <div className="max-h-64 overflow-y-auto p-1">
                      {pendingClient ? (
                        <>
                          {pendingClient.addresses.map((address) => (
                            <button
                              key={address.id}
                              type="button"
                              className="flex min-h-11 w-full rounded-sm px-2 py-2 text-left text-sm leading-snug hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => selectAddress(pendingClient, address.id)}
                            >
                              <span className="line-clamp-3 whitespace-pre-line">{address.address}</span>
                            </button>
                          ))}
                        </>
                      ) : (
                        clients.map((client) => (
                          <button
                            key={client.id}
                            type="button"
                            className="flex min-h-11 w-full flex-col justify-center rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => selectClient(client)}
                          >
                            <span className="font-medium">{client.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {client.addresses.length > 1
                                ? `${client.addresses.length} saved addresses`
                                : client.addresses[0]?.address || "No saved address"}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1.5"><Label>Name</Label><Input {...register("to.name")} placeholder="Client name" /></div>
            <div className="space-y-1.5"><Label>Address</Label><Textarea {...register("to.address")} placeholder="456 Client Ave…" rows={2} className="resize-none" /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input {...register("to.email")} type="email" /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input {...register("to.phone")} /></div>

            {canSaveClient && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11"
                onClick={() => saveClientMutation.mutate()}
                disabled={!billTo?.name?.trim() || saveClientMutation.isPending}
              >
                {saveClientMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-4 w-4" />
                )}
                Save Client
              </Button>
            )}
          </section>
        </div>

        <Separator />

        {/* Line Items */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Line Items</h2>
            <Button type="button" variant="outline" size="sm" className="h-11" onClick={() => append(defaultLineItem())}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Item
            </Button>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <div className="invoice-line-items overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="w-12 pb-2" />
                    <th className="text-left pb-2 w-[38%]">Description</th>
                    <th className="text-right pb-2 w-[10%]">Qty</th>
                    <th className="text-left pb-2 w-[10%] pl-2">Unit</th>
                    <th className="text-right pb-2 w-[17%]">Unit Price</th>
                    <th className="text-right pb-2 w-[14%]">Subtotal</th>
                    <th className="w-[7%]" />
                  </tr>
                </thead>
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
                          <td data-label="Description" className="py-1.5 pr-2">
                            <Input {...register(`line_items.${i}.description`)} placeholder="Description" className="h-12" />
                          </td>
                          <td data-label="Quantity" className="py-1.5 pr-2">
                            <Input
                              {...register(`line_items.${i}.quantity`, { valueAsNumber: true })}
                              type="number" min={0} step="any"
                              className="h-12 text-right"
                            />
                          </td>
                          <td data-label="Unit" className="py-1.5 pr-2 pl-2">
                            <Input {...register(`line_items.${i}.unit`)} className="h-12" />
                          </td>
                          <td data-label="Unit price" className="py-1.5 pr-2">
                            <Input
                              {...register(`line_items.${i}.unit_price`, { valueAsNumber: true })}
                              type="number" min={0} step="any"
                              className="h-12 text-right"
                            />
                          </td>
                          <td data-label="Subtotal" className="py-1.5 pr-2 text-right font-mono text-xs pt-3">{fmt(sub)}</td>
                          <td data-label="Actions" className="py-1.5 text-center">
                            <Button
                              type="button" variant="ghost" size="icon"
                              className="h-11 w-11 text-muted-foreground hover:text-destructive"
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
              </table>
            </div>
          </DndContext>

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

      <Dialog open={showEmailPrompt} onOpenChange={(open) => { if (!open) skipEmail() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email this invoice now?</DialogTitle>
            <DialogDescription>
              The invoice is saved. You can review the message, preview the PDF, and send it now.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={skipEmail}>Not now</Button>
            <Button type="button" onClick={openEmailDialog}>Email Invoice</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EmailInvoiceDialog
        record={emailDialogRecord}
        onOpenChange={(open) => {
          if (!open) {
            setEmailDialogRecord(null)
            navigate("/invoices")
          }
        }}
      />
    </div>
  )
}
