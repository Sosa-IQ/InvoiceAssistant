import type { BusinessSettings } from "@/types/invoice"
import api from "./client"

type SettingsPayload = Omit<
  BusinessSettings,
  "id" | "user_id" | "updated_at" | "onboarding_completed_at"
>

export async function getSettings(): Promise<BusinessSettings> {
  const { data } = await api.get<BusinessSettings>("/api/settings")
  return data
}

export async function updateSettings(body: Partial<SettingsPayload>): Promise<BusinessSettings> {
  const { data } = await api.put<BusinessSettings>("/api/settings", body)
  return data
}
