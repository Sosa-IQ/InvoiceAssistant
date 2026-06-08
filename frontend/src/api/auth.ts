import type { AuthMeResponse } from "@/types/invoice"
import api from "./client"

export async function getCurrentUserProfile(): Promise<AuthMeResponse> {
  const { data } = await api.get<AuthMeResponse>("/api/auth/me")
  return data
}
