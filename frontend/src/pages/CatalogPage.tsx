import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Pencil, Trash2, Package } from "lucide-react"
import { toast } from "sonner"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { listCatalog, createCatalogItem, updateCatalogItem, deleteCatalogItem } from "@/api/catalog"
import type { CatalogItem } from "@/types/invoice"

type ItemFormData = Omit<CatalogItem, "id" | "created_at" | "updated_at">

export default function CatalogPage() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CatalogItem | null>(null)

  const { data: items = [] } = useQuery<CatalogItem[]>({
    queryKey: ["catalog"],
    queryFn: () => listCatalog(),
  })

  const { register, handleSubmit, reset } = useForm<ItemFormData>()

  const saveMutation = useMutation({
    mutationFn: (data: ItemFormData) =>
      editing ? updateCatalogItem(editing.id, data) : createCatalogItem(data),
    onSuccess: () => {
      toast.success(editing ? "Item updated." : "Item created.")
      qc.invalidateQueries({ queryKey: ["catalog"] })
      setOpen(false)
    },
    onError: () => toast.error("Failed to save item."),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteCatalogItem,
    onSuccess: () => { toast.success("Item deleted."); qc.invalidateQueries({ queryKey: ["catalog"] }) },
    onError: () => toast.error("Failed to delete item."),
  })

  function openCreate() {
    setEditing(null)
    reset({ description: "", unit_price: 0, unit: "item", notes: null })
    setOpen(true)
  }

  function openEdit(item: CatalogItem) {
    setEditing(item)
    reset({ description: item.description, unit_price: item.unit_price, unit: item.unit, notes: item.notes })
    setOpen(true)
  }

  function fmt(n: number) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Catalog</h1>
        <Button onClick={openCreate}><Plus className="mr-1.5 h-4 w-4" />Add Item</Button>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
          No catalog items yet.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.description}</TableCell>
                <TableCell>{item.unit}</TableCell>
                <TableCell className="text-right font-mono">{fmt(item.unit_price)}</TableCell>
                <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground">{item.notes ?? "—"}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => { if (confirm(`Delete "${item.description}"?`)) deleteMutation.mutate(item.id) }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Item" : "New Item"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((d) => saveMutation.mutate(d))} className="space-y-3">
            <div className="space-y-1.5"><Label>Description *</Label><Input {...register("description", { required: true })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Unit Price</Label>
                <Input {...register("unit_price", { valueAsNumber: true })} type="number" min={0} step="0.01" />
              </div>
              <div className="space-y-1.5"><Label>Unit</Label><Input {...register("unit")} placeholder="item" /></div>
            </div>
            <div className="space-y-1.5"><Label>Notes</Label><Textarea {...register("notes")} rows={2} className="resize-none" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saveMutation.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
