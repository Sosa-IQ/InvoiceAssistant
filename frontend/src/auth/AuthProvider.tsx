import { createContext, useContext, useEffect, useState } from "react"
import type { Session, User } from "@supabase/supabase-js"
import { toast } from "sonner"
import { getCurrentUserProfile } from "@/api/auth"
import { isSupabaseConfigured, supabase } from "@/lib/supabase"

type AuthContextValue = {
  session: Session | null
  user: User | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    async function bootstrapSession(nextSession: Session | null) {
      setSession(nextSession)
      if (!nextSession) {
        setLoading(false)
        return
      }

      try {
        await getCurrentUserProfile()
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not initialize your account."
        toast.error(message)
      } finally {
        setLoading(false)
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      void bootstrapSession(data.session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setLoading(true)
      void bootstrapSession(nextSession)
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signOut: async () => {
          await supabase.auth.signOut()
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used within AuthProvider.")
  return value
}
