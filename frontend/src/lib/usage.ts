function clampRatio(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * Share of everything available this period (plan allowance plus top-ups) that is used,
 * so buying a top-up visibly lowers the bar. Without Pro, falls back to the plan ratio.
 */
export function usedShare(used: number, remaining: number, planRatio: number, proEntitled: boolean) {
  if (!proEntitled) return clampRatio(planRatio)
  const total = used + remaining
  return total > 0 ? clampRatio(used / total) : 0
}
