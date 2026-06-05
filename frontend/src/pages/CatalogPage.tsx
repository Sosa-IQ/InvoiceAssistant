import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plus, Pencil, Sparkles, Trash2, Package } from "lucide-react"
import { toast } from "sonner"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
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
import {
  listCatalog,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
  recommendCatalogItems,
} from "@/api/catalog"
import type { CatalogItem, CatalogRecommendation } from "@/types/invoice"

type ItemFormData = Omit<CatalogItem, "id" | "created_at" | "updated_at">

export default function CatalogPage() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CatalogItem | null>(null)
  const [recommendationsOpen, setRecommendationsOpen] = useState(false)
  const [recommendations, setRecommendations] = useState<CatalogRecommendation[]>([])
  const [savedRecommendations, setSavedRecommendations] = useState<string[]>([])
  const [savingRecommendationKeys, setSavingRecommendationKeys] = useState<string[]>([])

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

  const recommendMutation = useMutation({
    mutationFn: recommendCatalogItems,
    onSuccess: (data) => {
      setRecommendations(data)
      setSavedRecommendations([])
      setSavingRecommendationKeys([])
      setRecommendationsOpen(true)
      if (data.length === 0) toast.info("No new catalog recommendations found.")
    },
    onError: () => toast.error("Failed to get catalog recommendations."),
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

  function recommendationKey(item: CatalogRecommendation) {
    return `${item.description.trim().toLowerCase()}|${item.unit.trim().toLowerCase()}|${item.unit_price}`
  }

  async function saveRecommendation(item: CatalogRecommendation) {
    const key = recommendationKey(item)
    setSavingRecommendationKeys((keys) => [...keys, key])
    try {
      await createCatalogItem({
        description: item.description,
        unit: item.unit,
        unit_price: item.unit_price,
        notes: item.notes,
      })
      setSavedRecommendations((keys) => [...keys, key])
      await qc.invalidateQueries({ queryKey: ["catalog"] })
      toast.success(`Saved "${item.description}".`)
    } catch {
      toast.error(`Failed to save "${item.description}".`)
    } finally {
      setSavingRecommendationKeys((keys) => keys.filter((savedKey) => savedKey !== key))
    }
  }

  async function saveAllRecommendations() {
    const unsaved = recommendations.filter((item) => !savedRecommendations.includes(recommendationKey(item)))
    for (const item of unsaved) {
      await saveRecommendation(item)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Catalog</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => recommendMutation.mutate()}
            disabled={recommendMutation.isPending}
          >
            {recommendMutation.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-4 w-4" />
            )}
            Recommend
          </Button>
          <Button onClick={openCreate}><Plus className="mr-1.5 h-4 w-4" />Add Item</Button>
        </div>
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

      <Dialog open={recommendationsOpen} onOpenChange={setRecommendationsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Catalog Recommendations</DialogTitle>
          </DialogHeader>

          {recommendations.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No new recommendations found.
            </div>
          ) : (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {recommendations.map((item) => {
                const key = recommendationKey(item)
                const saved = savedRecommendations.includes(key)
                const saving = savingRecommendationKeys.includes(key)

                return (
                  <div key={key} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="font-medium leading-snug">{item.description}</div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{item.unit}</span>
                          {item.unit_price > 0 && <span className="font-mono">{fmt(item.unit_price)}</span>}
                          <Badge variant="secondary">{Math.round(item.confidence * 100)}%</Badge>
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={saved ? "secondary" : "outline"}
                        disabled={saved || saving}
                        onClick={() => saveRecommendation(item)}
                      >
                        {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                        {saved ? "Saved" : "Save"}
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{item.reason}</p>
                    {item.invoice_examples.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Seen in {item.invoice_examples.join(", ")}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRecommendationsOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              disabled={
                recommendations.length === 0 ||
                savingRecommendationKeys.length > 0 ||
                recommendations.every((item) => savedRecommendations.includes(recommendationKey(item)))
              }
              onClick={saveAllRecommendations}
            >
              Save All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
