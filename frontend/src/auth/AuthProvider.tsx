import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { Session } from "@supabase/supabase-js"
import { toast } from "sonner"
import { AuthContext } from "@/auth/AuthContext"
import { getCurrentUserProfile } from "@/api/auth"
import { isSupabaseConfigured, supabase } from "@/lib/supabase"

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const previousUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    async function bootstrapSession(nextSession: Session | null) {
      const nextUserId = nextSession?.user.id ?? null
      if (previousUserIdRef.current !== nextUserId) {
        queryClient.clear()
        previousUserIdRef.current = nextUserId
      }

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
  }, [queryClient])

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
