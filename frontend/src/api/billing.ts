import api from "./client"

export type BillingPlan = {
  code: "free" | "pro"
  name: string
  price_cents: number
  currency: string
  interval: "month"
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

export type BillingSession = { url: string }

export async function getBillingPlans(): Promise<BillingPlansResponse> {
  const { data } = await api.get<BillingPlansResponse>("/api/billing/plans")
  return data
}

export async function getBillingStatus(): Promise<BillingStatus> {
  const { data } = await api.get<BillingStatus>("/api/billing/status")
  return data
}

export async function createCheckoutSession(): Promise<BillingSession> {
  const { data } = await api.post<BillingSession>("/api/billing/checkout-session")
  return data
}

export async function createPortalSession(): Promise<BillingSession> {
  const { data } = await api.post<BillingSession>("/api/billing/portal-session")
  return data
}
