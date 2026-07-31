import { useState, type ReactNode } from "react"
import { Lock, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProUpgradeDialog } from "@/components/ProUpgradeDialog"
import { LAUNCH_PROMO_SHORT } from "@/lib/brand"

type ProLockedPanelProps = {
  title: string
  feature: string
  description: string
  className?: string
  children?: ReactNode
}

/**
 * Inline teaser for Pro-only UI.
 * Brand greens in both themes; dark mode uses lime tints on deep green so it
 * stays readable and the upgrade CTA still pops.
 */
export function ProLockedPanel({
  title,
  feature,
  description,
  className = "",
  children,
}: ProLockedPanelProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
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
            <Lock className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[#557067] dark:text-[#c5d6cf]">
              Pro feature
            </p>
            <h2 className="mt-1 text-lg font-black tracking-tight text-foreground">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
            <p className="mt-2 text-sm font-semibold text-[#31533f] dark:text-[#c8e68a]">
              {LAUNCH_PROMO_SHORT}
            </p>
            {children}
            <Button
              type="button"
              className={[
                "mt-4 min-h-11 rounded-xl font-black shadow-sm",
                "bg-[#183a32] text-white hover:bg-[#264d43]",
                "dark:bg-[#b8dc72] dark:text-[#17372f] dark:hover:bg-[#c8e68a]",
              ].join(" ")}
              onClick={() => setOpen(true)}
            >
              <Sparkles className="h-4 w-4" />
              Unlock with Pro
            </Button>
          </div>
        </div>
      </section>
      <ProUpgradeDialog open={open} onOpenChange={setOpen} feature={feature} description={description} />
    </>
  )
}
