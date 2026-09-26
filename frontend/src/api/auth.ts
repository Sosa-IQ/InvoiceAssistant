import type { AuthMeResponse } from "@/types/invoice"
import api from "./client"

export async function getCurrentUserProfile(): Promise<AuthMeResponse> {
  const { data } = await api.get<AuthMeResponse>("/api/auth/me")
  return data
}

export async function deleteAccount(confirmEmail: string): Promise<void> {
  await api.delete("/api/auth/account", { data: { confirm_email: confirmEmail } })
}
