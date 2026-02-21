import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Pencil, Trash2, Users } from "lucide-react"
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
import { listClients, createClient, updateClient, deleteClient } from "@/api/clients"
import type { Client } from "@/types/invoice"

type ClientFormData = Omit<Client, "id" | "created_at" | "updated_at">

export default function ClientsPage() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Client | null>(null)

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: () => listClients(),
  })

  const { register, handleSubmit, reset } = useForm<ClientFormData>()

  const saveMutation = useMutation({
    mutationFn: (data: ClientFormData) =>
      editing ? updateClient(editing.id, data) : createClient(data),
    onSuccess: () => {
      toast.success(editing ? "Client updated." : "Client created.")
      qc.invalidateQueries({ queryKey: ["clients"] })
      setOpen(false)
    },
    onError: () => toast.error("Failed to save client."),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteClient,
    onSuccess: () => { toast.success("Client deleted."); qc.invalidateQueries({ queryKey: ["clients"] }) },
    onError: () => toast.error("Failed to delete client."),
  })

  function openCreate() {
    setEditing(null)
    reset({ name: "", address: null, email: null, phone: null, notes: null })
    setOpen(true)
  }

  function openEdit(c: Client) {
    setEditing(c)
    reset({ name: c.name, address: c.address, email: c.email, phone: c.phone, notes: c.notes })
    setOpen(true)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <Button onClick={openCreate}><Plus className="mr-1.5 h-4 w-4" />Add Client</Button>
      </div>

      {clients.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
          No clients yet.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Address</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{c.email ?? "—"}</TableCell>
                <TableCell>{c.phone ?? "—"}</TableCell>
                <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">{c.address ?? "—"}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => { if (confirm(`Delete ${c.name}?`)) deleteMutation.mutate(c.id) }}
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
            <DialogTitle>{editing ? "Edit Client" : "New Client"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((d) => saveMutation.mutate(d))} className="space-y-3">
            <div className="space-y-1.5"><Label>Name *</Label><Input {...register("name", { required: true })} /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input {...register("email")} type="email" /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input {...register("phone")} /></div>
            <div className="space-y-1.5"><Label>Address</Label><Textarea {...register("address")} rows={2} className="resize-none" /></div>
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
