import { useMutation } from "@tanstack/react-query"
import { Gauge, Loader2, Sparkles } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { createPackCheckoutSession } from "@/api/billing"
import { Button } from "@/components/ui/button"
import { redirectToStripe } from "@/lib/externalNavigation"

type UsageLimitPanelProps = {
  /** Which allowance ran out. */
  kind: "ai" | "voice"
  /** When the included allowance resets (ISO timestamp). */
  periodEnd: string | null
  canBuyTopUp: boolean
  className?: string
}

const COPY = {
  ai: {
    title: "You've used this month's AI",
    body: "AI drafting, AI edits, and voice notes are paused until you add more usage.",
  },
  voice: {
    title: "You've used this month's voice",
    body: "Voice notes are paused until you add more usage. You can still type what to bill for.",
  },
}

/**
 * Shown in place of AI or voice controls when a Pro account's allowance is used up.
 * Mirrors ProLockedPanel so the paused state looks like the Free lock, with a
 * top-up offer instead of an upgrade.
 */
export function UsageLimitPanel({ kind, periodEnd, canBuyTopUp, className = "" }: UsageLimitPanelProps) {
  const checkout = useMutation({
    mutationFn: () => createPackCheckoutSession("ai_topup"),
    onSuccess: ({ url }) => {
      try {
        redirectToStripe(url)
      } catch {
        toast.error("The billing link was invalid. Please try again.")
      }
    },
    onError: () => toast.error("Top-up checkout could not be started. Please try again."),
  })
  const resets = periodEnd
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(periodEnd))
    : null

  return (
    <section
      className={[
        "rounded-[24px] border border-dashed p-5 shadow-sm sm:p-6",
        "border-[#9dbb63]/80 bg-[#eff8d8]/75",
        "dark:border-[#b8dc72]/55 dark:bg-[#b8dc72]/12",
        className,
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <span
          className={[
            "grid h-11 w-11 shrink-0 place-items-center rounded-2xl",
            "bg-[#dff0ba] text-[#183a32]",
            "dark:bg-[#b8dc72]/22 dark:text-[#d4ee9a]",
          ].join(" ")}
        >
          <Gauge className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#557067] dark:text-[#c5d6cf]">
            Usage limit reached
          </p>
          <h2 className="mt-1 text-lg font-black tracking-tight text-foreground">{COPY[kind].title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {COPY[kind].body}
            {resets ? ` Your included usage resets ${resets}.` : ""}
          </p>
          {canBuyTopUp && (
            <p className="mt-2 text-sm font-semibold text-[#31533f] dark:text-[#c8e68a]">
              An AI top-up adds extra AI and voice usage together for $5.
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {canBuyTopUp && (
              <Button
                type="button"
                disabled={checkout.isPending}
                className={[
                  "min-h-11 rounded-xl font-black shadow-sm",
                  "bg-[#183a32] text-white hover:bg-[#264d43]",
                  "dark:bg-[#b8dc72] dark:text-[#17372f] dark:hover:bg-[#c8e68a]",
                ].join(" ")}
                onClick={() => checkout.mutate()}
              >
                {checkout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Buy AI top-up — $5
              </Button>
            )}
            <Button asChild variant="ghost" className="min-h-11 rounded-xl">
              <Link to="/billing">View usage</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
