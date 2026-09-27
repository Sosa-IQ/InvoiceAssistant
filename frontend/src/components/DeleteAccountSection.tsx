import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { isAxiosError } from "axios"
import { Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { deleteAccount } from "@/api/auth"
import { useAuth } from "@/auth/AuthContext"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function DeleteAccountSection() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [deleting, setDeleting] = useState(false)
  const email = user?.email ?? ""
  const matches = email !== "" && typed.trim().toLowerCase() === email.toLowerCase()

  async function onDelete() {
    setDeleting(true)
    try {
      await deleteAccount(typed.trim())
      // The session's user no longer exists; clear it locally and leave the app.
      await signOut().catch(() => {})
      toast.success("Your account has been deleted.")
      navigate("/", { replace: true })
    } catch (error) {
      const detail = isAxiosError(error) ? error.response?.data?.detail : null
      toast.error(typeof detail === "string" ? detail : "Could not delete your account. Please try again.")
      setDeleting(false)
    }
  }

  return (
    <section className="rounded-[24px] border border-destructive/30 bg-card p-4 shadow-sm sm:p-6">
      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-destructive/10 text-destructive">
          <Trash2 className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-black">Delete account</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Permanently delete your account, invoices, clients, catalog, and saved PDFs. This cannot be undone.
          </p>
          <Button type="button" variant="outline" className="mt-4 border-destructive/40 text-destructive" onClick={() => setOpen(true)}>
            Delete account
          </Button>
        </div>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (deleting) return
          setOpen(next)
          if (!next) setTyped("")
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription className="text-left leading-6">
              Everything in your workspace is removed right away. If you have Pro, your subscription is canceled
              immediately with no refund for the current period, and unused top-up packs are lost.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="delete-account-confirm">
              Type <span className="break-all font-bold">{email}</span> to confirm
            </Label>
            <Input
              id="delete-account-confirm"
              type="email"
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              disabled={deleting}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={onDelete} disabled={!matches || deleting}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
