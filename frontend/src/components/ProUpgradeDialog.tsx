import { useMutation } from "@tanstack/react-query"
import { ArrowRight, Loader2, Sparkles } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { createCheckoutSession } from "@/api/billing"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LAUNCH_PROMO_BLURB, LAUNCH_PROMO_SHORT } from "@/lib/brand"
import { redirectToStripe } from "@/lib/externalNavigation"
import { useProAccess } from "@/hooks/useProAccess"

type ProUpgradeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Short label for the locked feature, e.g. "Email invoices". */
  feature: string
  description?: string
}

export function ProUpgradeDialog({
  open,
  onOpenChange,
  feature,
  description,
}: ProUpgradeDialogProps) {
  const { configured } = useProAccess()
  const checkout = useMutation({
    mutationFn: () => createCheckoutSession("month"),
    onSuccess: ({ url }) => {
      try {
        redirectToStripe(url)
      } catch {
        toast.error("The billing link was invalid. Please try again.")
      }
    },
    onError: () => toast.error("Checkout could not be started. Please try again."),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eff8d8] text-[#31533f]">
            <Sparkles className="h-5 w-5" aria-hidden />
          </div>
          <DialogTitle>Pro unlocks {feature}</DialogTitle>
          <DialogDescription className="text-left leading-6">
            {description ??
              `${feature} is included with Cuenvia Pro — along with AI drafting, voice, and more.`}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-2xl border border-[#9dbb63] bg-[#eff8d8]/70 p-4 text-sm leading-6 text-[#274b31]">
          <p className="font-black">{LAUNCH_PROMO_SHORT}</p>
          <p className="mt-1 text-[#31533f]">{LAUNCH_PROMO_BLURB}</p>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" className="min-h-11 rounded-xl" asChild>
            <Link to="/pricing" onClick={() => onOpenChange(false)}>
              See plans
            </Link>
          </Button>
          {configured ? (
            <Button
              type="button"
              className="min-h-11 rounded-xl bg-[#183a32] font-black text-white hover:bg-[#264d43]"
              disabled={checkout.isPending}
              onClick={() => checkout.mutate()}
            >
              {checkout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Upgrade to Pro
              {!checkout.isPending && <ArrowRight className="h-4 w-4" />}
            </Button>
          ) : (
            <Button type="button" className="min-h-11 rounded-xl" asChild>
              <Link to="/pricing" onClick={() => onOpenChange(false)}>
                View pricing
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
