import axios from "axios"
import { toast } from "sonner"
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

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status
    if (status === 402) {
      const detail =
        typeof error?.response?.data?.detail === "string"
          ? error.response.data.detail
          : "A Pro plan is required for this feature."
      toast.error(detail, {
        duration: 8000,
        action: {
          label: "View plans",
          onClick: () => {
            window.location.assign("/pricing")
          },
        },
      })
    }
    return Promise.reject(error)
  },
)

export default api
