import type { BusinessSettings } from "@/types/invoice"
import api from "./client"

export async function getSettings(): Promise<BusinessSettings> {
  const { data } = await api.get<BusinessSettings>("/api/settings")
  return data
}

export async function updateSettings(body: Partial<Omit<BusinessSettings, "id" | "updated_at">>): Promise<BusinessSettings> {
  const { data } = await api.put<BusinessSettings>("/api/settings", body)
  return data
}
