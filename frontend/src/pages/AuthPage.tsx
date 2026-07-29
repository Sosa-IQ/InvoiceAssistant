import { useEffect, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { Loader2, LockKeyhole, UserPlus } from "lucide-react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { isSupabaseConfigured, missingSupabaseEnvVars, supabase } from "@/lib/supabase"
import { useAuth } from "@/auth/AuthContext"

type AuthFormData = {
  email: string
  password: string
}

export default function AuthPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState<"login" | "signup">("login")
  const [loading, setLoading] = useState(false)
  const { register, handleSubmit } = useForm<AuthFormData>()
  const redirectTo = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/invoices"

  useEffect(() => {
    if (user) navigate(redirectTo, { replace: true })
  }, [navigate, redirectTo, user])

  async function onSubmit(values: AuthFormData) {
    if (!isSupabaseConfigured) {
      toast.error("Supabase environment variables are not configured.")
      return
    }

    setLoading(true)
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: values.email,
          password: values.password,
        })
        if (error) throw error
        toast.success("Account created.")
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: values.email,
          password: values.password,
        })
        if (error) throw error
        toast.success("Signed in.")
      }
      navigate(redirectTo, { replace: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed."
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-dvh overflow-x-hidden bg-background px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-8 md:grid md:min-h-[75vh] md:grid-cols-[1.1fr_0.9fr] md:items-center md:gap-14">
        <section className="min-w-0 space-y-6">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-2xl bg-primary text-sm font-black text-primary-foreground shadow-sm">IA</span>
            <div><p className="font-black">Invoice Assistant</p><p className="text-xs text-muted-foreground">Simple invoicing</p></div>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-bold text-muted-foreground">
            <LockKeyhole aria-hidden="true" className="h-3.5 w-3.5" />
            Your private invoice workspace
          </div>
          <div className="space-y-3">
            <h1 className="max-w-xl text-4xl font-black tracking-tight sm:text-5xl">Invoices without the fuss.</h1>
            <p className="max-w-xl break-words text-base leading-7 text-muted-foreground">
              Create invoices, keep client details together, and find your saved work without wrestling with complicated software.
            </p>
          </div>
          <Link to="/pricing" className="inline-flex min-h-11 items-center font-bold text-primary underline-offset-4 hover:underline">See simple pricing</Link>
        </section>

        <section className="w-full min-w-0 rounded-[28px] border bg-card p-5 shadow-[0_20px_55px_rgba(24,58,50,0.09)] sm:p-8">
          {!isSupabaseConfigured && (
            <div className="mb-5 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
              <p className="font-medium text-destructive">Supabase is not configured.</p>
              <p className="mt-1 text-muted-foreground">
                Add {missingSupabaseEnvVars.join(" and ")} to frontend/.env.local, then restart the frontend server.
              </p>
            </div>
          )}

          <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-muted p-1.5">
            <Button
              type="button"
              variant={mode === "login" ? "default" : "outline"}
              onClick={() => setMode("login")}
              className="min-h-11 rounded-xl"
            >
              Log In
            </Button>
            <Button
              type="button"
              variant={mode === "signup" ? "default" : "outline"}
              onClick={() => setMode("signup")}
              className="min-h-11 rounded-xl"
            >
              <UserPlus aria-hidden="true" className="mr-1.5 h-4 w-4" />
              Sign Up
            </Button>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="auth-email">Email</Label>
              <Input id="auth-email" type="email" autoComplete="email" {...register("email", { required: true })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auth-password">Password</Label>
              <Input id="auth-password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} {...register("password", { required: true, minLength: 8 })} />
            </div>
            <Button type="submit" className="min-h-12 w-full rounded-xl" disabled={loading}>
              {loading && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />}
              {mode === "signup" ? "Create Account" : "Log In"}
            </Button>
          </form>
        </section>
      </div>
    </div>
  )
}
