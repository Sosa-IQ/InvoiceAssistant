import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Pencil, Trash2, Users, MapPin } from "lucide-react"
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
import {
  listClients,
  createClient,
  updateClient,
  deleteClient,
  createClientAddress,
  updateClientAddress,
  deleteClientAddress,
} from "@/api/clients"
import type { Client, ClientAddress } from "@/types/invoice"

type ClientFormData = { name: string; email: string | null; phone: string | null; notes: string | null }
type AddressFormData = { label: string; address: string }

export default function ClientsPage() {
  const qc = useQueryClient()

  // Client dialog state
  const [clientOpen, setClientOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const clientForm = useForm<ClientFormData>()

  // Address dialog state
  const [addrOpen, setAddrOpen] = useState(false)
  const [addrClient, setAddrClient] = useState<Client | null>(null)
  const [editingAddr, setEditingAddr] = useState<ClientAddress | null>(null)
  const addrForm = useForm<AddressFormData>()

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: () => listClients(),
  })

  // ── Client mutations ────────────────────────────────────────────────
  const saveClientMutation = useMutation({
    mutationFn: (data: ClientFormData) =>
      editingClient ? updateClient(editingClient.id, data) : createClient(data),
    onSuccess: () => {
      toast.success(editingClient ? "Client updated." : "Client created.")
      qc.invalidateQueries({ queryKey: ["clients"] })
      setClientOpen(false)
    },
    onError: () => toast.error("Failed to save client."),
  })

  const deleteClientMutation = useMutation({
    mutationFn: deleteClient,
    onSuccess: () => { toast.success("Client deleted."); qc.invalidateQueries({ queryKey: ["clients"] }) },
    onError: () => toast.error("Failed to delete client."),
  })

  // ── Address mutations ───────────────────────────────────────────────
  const saveAddrMutation = useMutation({
    mutationFn: (data: AddressFormData) =>
      editingAddr
        ? updateClientAddress(addrClient!.id, editingAddr.id, data)
        : createClientAddress(addrClient!.id, data),
    onSuccess: () => {
      toast.success(editingAddr ? "Address updated." : "Address added.")
      qc.invalidateQueries({ queryKey: ["clients"] })
      closeAddrForm()
    },
    onError: () => toast.error("Failed to save address."),
  })

  const deleteAddrMutation = useMutation({
    mutationFn: ({ clientId, addressId }: { clientId: number; addressId: number }) =>
      deleteClientAddress(clientId, addressId),
    onSuccess: () => { toast.success("Address deleted."); qc.invalidateQueries({ queryKey: ["clients"] }) },
    onError: () => toast.error("Failed to delete address."),
  })

  // ── Client dialog helpers ───────────────────────────────────────────
  function openCreateClient() {
    setEditingClient(null)
    clientForm.reset({ name: "", email: null, phone: null, notes: null })
    setClientOpen(true)
  }

  function openEditClient(c: Client) {
    setEditingClient(c)
    clientForm.reset({ name: c.name, email: c.email, phone: c.phone, notes: c.notes })
    setClientOpen(true)
  }

  // ── Address dialog helpers ──────────────────────────────────────────
  function openAddAddr(c: Client) {
    setAddrClient(c)
    setEditingAddr(null)
    addrForm.reset({ label: "", address: "" })
    setAddrOpen(true)
  }

  function openEditAddr(c: Client, a: ClientAddress) {
    setAddrClient(c)
    setEditingAddr(a)
    addrForm.reset({ label: a.label ?? "", address: a.address })
    setAddrOpen(true)
  }

  function closeAddrForm() {
    setEditingAddr(null)
    setAddrOpen(false)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <Button onClick={openCreateClient}><Plus className="mr-1.5 h-4 w-4" />Add Client</Button>
      </div>

      {clients.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
          No clients yet.
        </div>
      ) : (
        <div className="space-y-4">
          {clients.map((c) => (
            <div key={c.id} className="border rounded-lg p-4 space-y-3">
              {/* Client header row */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-semibold text-base">{c.name}</div>
                  <div className="text-sm text-muted-foreground space-x-3">
                    {c.email && <span>{c.email}</span>}
                    {c.phone && <span>{c.phone}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditClient(c)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => { if (confirm(`Delete ${c.name}?`)) deleteClientMutation.mutate(c.id) }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Addresses */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Addresses
                  </span>
                  <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={() => openAddAddr(c)}>
                    <Plus className="h-3 w-3 mr-1" />Add
                  </Button>
                </div>

                {c.addresses.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No addresses yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs h-7">Label</TableHead>
                        <TableHead className="text-xs h-7">Address</TableHead>
                        <TableHead className="w-16 h-7" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {c.addresses.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="py-1.5 text-sm text-muted-foreground w-36">
                            {a.label ? (
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="h-3 w-3 shrink-0" />{a.label}
                              </span>
                            ) : (
                              <span className="text-xs italic text-muted-foreground/60">—</span>
                            )}
                          </TableCell>
                          <TableCell className="py-1.5 text-sm whitespace-pre-line">{a.address}</TableCell>
                          <TableCell className="py-1.5 text-right">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditAddr(c, a)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost" size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                if (confirm("Delete this address?"))
                                  deleteAddrMutation.mutate({ clientId: c.id, addressId: a.id })
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Client create/edit dialog */}
      <Dialog open={clientOpen} onOpenChange={setClientOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingClient ? "Edit Client" : "New Client"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={clientForm.handleSubmit((d) => saveClientMutation.mutate(d))} className="space-y-3">
            <div className="space-y-1.5"><Label>Name *</Label><Input {...clientForm.register("name", { required: true })} /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input {...clientForm.register("email")} type="email" /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input {...clientForm.register("phone")} /></div>
            <div className="space-y-1.5"><Label>Notes</Label><Textarea {...clientForm.register("notes")} rows={2} className="resize-none" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setClientOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saveClientMutation.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Address create/edit dialog */}
      <Dialog open={addrOpen} onOpenChange={setAddrOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingAddr ? "Edit Address" : `Add Address — ${addrClient?.name}`}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={addrForm.handleSubmit((d) => saveAddrMutation.mutate(d))} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Label <span className="text-muted-foreground text-xs">(optional, e.g. "Main Office")</span></Label>
              <Input {...addrForm.register("label")} placeholder="123 Oak St property" />
            </div>
            <div className="space-y-1.5">
              <Label>Address *</Label>
              <Textarea
                {...addrForm.register("address", { required: true })}
                placeholder={"123 Oak St\nSpringfield, IL 62701"}
                rows={3}
                className="resize-none"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeAddrForm}>Cancel</Button>
              <Button type="submit" disabled={saveAddrMutation.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
