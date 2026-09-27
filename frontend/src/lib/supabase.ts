import { createClient } from "@supabase/supabase-js"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const missingSupabaseEnvVars = [
  !supabaseUrl && "VITE_SUPABASE_URL",
  !supabaseAnonKey && "VITE_SUPABASE_ANON_KEY",
].filter(Boolean) as string[]

export const isSupabaseConfigured = missingSupabaseEnvVars.length === 0

// Read the auth redirect before the client consumes and clears the URL fragment.
function readAuthRedirect() {
  if (typeof window === "undefined") return { recovery: false, error: null as string | null }
  const params = new URLSearchParams(window.location.hash.slice(1))
  return { recovery: params.get("type") === "recovery", error: params.get("error_code") }
}

/** How this page load arrived: from a password-recovery link, or from an expired/used one. */
export const initialAuthRedirect = readAuthRedirect()

export const supabase = createClient(
  supabaseUrl || "http://localhost",
  supabaseAnonKey || "missing-anon-key"
)
