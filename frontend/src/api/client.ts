import axios from "axios"
import { isSupabaseConfigured, supabase } from "@/lib/supabase"

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000",
})

api.interceptors.request.use(async (config) => {
  if (!isSupabaseConfigured) {
    return config
  }

  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

export default api
