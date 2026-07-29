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
  // Monotonic id for each bootstrap. Only the latest generation owns the shared
  // session/profile/loading state; a stale overlapping call (e.g. an older
  // same-user refresh whose profile fetch settles after a newer identity
  // change) must not clear loading or surface its result.
  const bootstrapGenerationRef = useRef(0)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    async function bootstrapSession(nextSession: Session | null) {
      const generation = ++bootstrapGenerationRef.current
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
        if (generation !== bootstrapGenerationRef.current) return
        const message = error instanceof Error ? error.message : "Could not initialize your account."
        toast.error(message)
      } finally {
        if (generation === bootstrapGenerationRef.current) setLoading(false)
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      void bootstrapSession(data.session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null
      if (previousUserIdRef.current !== nextUserId) {
        setLoading(true)
      }
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
