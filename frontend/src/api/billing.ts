import api from "./client"

export type BillingPlan = {
  code: "free" | "pro"
  name: string
  price_cents: number
  currency: string
  interval: "month" | "year"
  features: string[]
}

export type BillingPlansResponse = {
  configured: boolean
  enforcement_enabled: boolean
  plans: BillingPlan[]
}

export type BillingStatus = {
  plan: "free" | "pro"
  status: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_price_id: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  configured: boolean
  enforcement_enabled: boolean
}

export type UsageStatus = {
  pro_entitled: boolean
  period_start: string
  period_end: string
  ai_tokens_included: number
  ai_tokens_used: number
  ai_tokens_pack_remaining: number
  ai_tokens_remaining: number
  ai_usage_ratio: number
  voice_seconds_included: number
  voice_seconds_used: number
  voice_seconds_pack_remaining: number
  voice_seconds_remaining: number
  voice_usage_ratio: number
  packs_frozen: boolean
  ai_pack_configured: boolean
  voice_pack_configured: boolean
}

export type BillingSession = { url: string }
export type PackKind = "ai_tokens" | "voice_seconds"

export async function getBillingPlans(): Promise<BillingPlansResponse> {
  const { data } = await api.get<BillingPlansResponse>("/api/billing/plans")
  return data
}

export async function getBillingStatus(): Promise<BillingStatus> {
  const { data } = await api.get<BillingStatus>("/api/billing/status")
  return data
}

export async function getUsageStatus(): Promise<UsageStatus> {
  const { data } = await api.get<UsageStatus>("/api/billing/usage")
  return data
}

export async function createCheckoutSession(): Promise<BillingSession> {
  const { data } = await api.post<BillingSession>("/api/billing/checkout-session")
  return data
}

export async function createPackCheckoutSession(pack: PackKind): Promise<BillingSession> {
  const { data } = await api.post<BillingSession>("/api/billing/pack-checkout-session", { pack })
  return data
}

export async function createPortalSession(): Promise<BillingSession> {
  const { data } = await api.post<BillingSession>("/api/billing/portal-session")
  return data
}
