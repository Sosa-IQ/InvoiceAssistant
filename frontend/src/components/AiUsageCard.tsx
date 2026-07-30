import { useQuery } from "@tanstack/react-query"
import { getUsageStatus } from "@/api/billing"

function clampRatio(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export default function AiUsageCard() {
  const usageQuery = useQuery({ queryKey: ["billing", "usage"], queryFn: getUsageStatus })

  if (usageQuery.isPending) {
    return (
      <section className="rounded-[24px] border bg-card p-5 shadow-sm sm:p-6">
        <p className="text-sm text-muted-foreground">Loading AI usage…</p>
      </section>
    )
  }
  if (usageQuery.isError || !usageQuery.data) {
    return null
  }

  const usage = usageQuery.data
  const aiPct = Math.round(clampRatio(usage.ai_usage_ratio) * 100)
  const voicePct = Math.round(clampRatio(usage.voice_usage_ratio) * 100)

  return (
    <section className="rounded-[24px] border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-black tracking-tight text-foreground">AI usage</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Included monthly usage resets with your plan. Purchased top-ups roll until used
            {usage.packs_frozen ? " and stay frozen while Pro is inactive" : ""}.
          </p>
        </div>
        {!usage.pro_entitled && (
          <p className="text-sm font-semibold text-destructive">Pro required for AI and voice</p>
        )}
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold text-foreground">AI usage</span>
            <span className="tabular-nums text-muted-foreground">{aiPct}%</span>
          </div>
          <div
            className="h-3 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="AI usage"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={aiPct}
          >
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${aiPct}%` }} />
          </div>
          {usage.ai_tokens_pack_remaining > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Top-up balance available{usage.packs_frozen ? " (frozen until Pro returns)" : ""}.
            </p>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold text-foreground">Voice usage</span>
            <span className="tabular-nums text-muted-foreground">{voicePct}%</span>
          </div>
          <div
            className="h-3 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Voice usage"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={voicePct}
          >
            <div className="h-full rounded-full bg-chart-2 transition-all" style={{ width: `${voicePct}%` }} />
          </div>
        </div>
      </div>

      <details className="mt-5 rounded-2xl border border-border bg-muted/40 p-4">
        <summary className="cursor-pointer text-sm font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          How usage works
        </summary>
        <div className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
          <p>
            AI usage covers generating a new invoice draft and asking AI to update an existing draft. Longer
            instructions use more of your monthly allowance.
          </p>
          <p>Voice usage covers transcription time. Keep clips short for best results.</p>
          <p>
            Your plan’s included AI and voice reset each billing period and do not roll over. Top-up packs you buy roll
            until they are used, but only while Pro is active. If Pro ends, top-ups freeze and return when you
            resubscribe.
          </p>
          <p>You can always create and edit invoices manually, even if AI usage is full.</p>
        </div>
      </details>
    </section>
  )
}
