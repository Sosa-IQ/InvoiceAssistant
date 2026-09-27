import { useEffect, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { Loader2, LockKeyhole, MailCheck, UserPlus } from "lucide-react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { isSupabaseConfigured, missingSupabaseEnvVars, supabase } from "@/lib/supabase"
import { useAuth } from "@/auth/AuthContext"
import { Turnstile } from "@/components/Turnstile"
import { TURNSTILE_SITE_KEY } from "@/lib/turnstile"
import { APP_INITIALS, APP_NAME, APP_TAGLINE } from "@/lib/brand"

type AuthFormData = {
  email: string
  password: string
}

type AuthMode = "login" | "signup" | "forgot"

/** Supabase's messages are written for developers; translate the ones people hit. */
function friendlyAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes("invalid login credentials")) return "That email and password don't match. Try again or reset your password."
  if (m.includes("email not confirmed")) return "Please confirm your email first. Check your inbox for the link we sent."
  if (m.includes("rate limit")) return "Too many attempts. Please wait a few minutes and try again."
  if (m.includes("captcha")) return "The security check didn't go through. Please try again."
  if (m.includes("password")) return message
  return "Something went wrong. Please try again."
}

export default function AuthPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const initialMode = (location.state as { mode?: AuthMode } | null)?.mode === "signup" ? "signup" : "login"
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [loading, setLoading] = useState(false)
  // Set after a request that finishes by email (signup confirmation or password reset).
  const [sentTo, setSentTo] = useState<{ email: string; kind: "confirm" | "reset" } | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  // Turnstile tokens are single-use; bumping this remounts the widget for a fresh one.
  const [captchaKey, setCaptchaKey] = useState(0)
  const captchaRequired = TURNSTILE_SITE_KEY !== ""
  const captcha = captchaToken ?? undefined
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AuthFormData>()
  // Shown inside the form for problems the user can fix (existing account, wrong password).
  const [formError, setFormError] = useState<{ message: string; existingAccount?: boolean } | null>(null)
  const redirectTo = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/invoices"

  useEffect(() => {
    if (user) navigate(redirectTo, { replace: true })
  }, [navigate, redirectTo, user])

  function switchMode(next: AuthMode) {
    setFormError(null)
    setMode(next)
  }

  async function onSubmit(values: AuthFormData) {
    if (!isSupabaseConfigured) {
      toast.error("Supabase environment variables are not configured.")
      return
    }

    setLoading(true)
    setFormError(null)
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
          redirectTo: `${window.location.origin}/reset-password`,
          captchaToken: captcha,
        })
        if (error) throw error
        // Same message whether or not the address has an account, so the form can't be used to probe emails.
        setSentTo({ email: values.email, kind: "reset" })
        return
      }
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: values.email,
          password: values.password,
          options: { emailRedirectTo: `${window.location.origin}/invoices`, captchaToken: captcha },
        })
        if (error) throw error
        // An already-registered email comes back as a user with no identities and no email is sent.
        if (data.user && data.user.identities?.length === 0) {
          setFormError({ message: "An account with this email already exists.", existingAccount: true })
          return
        }
        if (!data.session) {
          // Email confirmation is required before the account can sign in.
          setSentTo({ email: values.email, kind: "confirm" })
          return
        }
        toast.success("Account created.")
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: values.email,
          password: values.password,
          options: { captchaToken: captcha },
        })
        if (error) throw error
        toast.success("Signed in.")
      }
      navigate(redirectTo, { replace: true })
    } catch (error) {
      setFormError({ message: friendlyAuthError(error instanceof Error ? error.message : "") })
    } finally {
      setLoading(false)
      if (captchaRequired) setCaptchaKey((key) => key + 1)
    }
  }

  return (
    <div className="min-h-dvh overflow-x-hidden bg-background px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-8 md:grid md:min-h-[75vh] md:grid-cols-[1.1fr_0.9fr] md:items-center md:gap-14">
        <section className="min-w-0 space-y-6">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-2xl bg-primary text-sm font-black text-primary-foreground shadow-sm">{APP_INITIALS}</span>
            <div><p className="font-black">{APP_NAME}</p><p className="text-xs text-muted-foreground">{APP_TAGLINE}</p></div>
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

          {sentTo ? (
            <div className="space-y-4 text-center" role="status">
              <MailCheck aria-hidden="true" className="mx-auto h-10 w-10 text-primary" />
              <h2 className="text-xl font-black">Check your email</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                {sentTo.kind === "confirm"
                  ? <>We sent a confirmation link to <strong className="break-all text-foreground">{sentTo.email}</strong>. Open it to finish creating your account.</>
                  : <>If an account exists for <strong className="break-all text-foreground">{sentTo.email}</strong>, we sent a link to reset your password.</>}
              </p>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full rounded-xl"
                onClick={() => {
                  setSentTo(null)
                  setMode("login")
                }}
              >
                Back to log in
              </Button>
            </div>
          ) : (
            <>
              {mode === "forgot" ? (
                <div className="mb-6 space-y-1.5">
                  <h2 className="text-xl font-black">Reset your password</h2>
                  <p className="text-sm text-muted-foreground">Enter your account email and we will send you a reset link.</p>
                </div>
              ) : (
                <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-muted p-1.5">
                  <Button
                    type="button"
                    variant={mode === "login" ? "default" : "outline"}
                    onClick={() => switchMode("login")}
                    className="min-h-11 rounded-xl"
                  >
                    Log In
                  </Button>
                  <Button
                    type="button"
                    variant={mode === "signup" ? "default" : "outline"}
                    onClick={() => switchMode("signup")}
                    className="min-h-11 rounded-xl"
                  >
                    <UserPlus aria-hidden="true" className="mr-1.5 h-4 w-4" />
                    Sign Up
                  </Button>
                </div>
              )}

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="auth-email">Email</Label>
                  <Input
                    id="auth-email"
                    type="email"
                    autoComplete="email"
                    aria-invalid={Boolean(errors.email)}
                    {...register("email", { required: "Enter your email address." })}
                  />
                  {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
                </div>
                {mode !== "forgot" && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="auth-password">Password</Label>
                      {mode === "login" && (
                        <button
                          type="button"
                          onClick={() => switchMode("forgot")}
                          className="text-sm font-bold text-primary underline-offset-4 hover:underline"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <Input id="auth-password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} aria-invalid={Boolean(errors.password)} {...register("password", { required: "Enter your password.", minLength: { value: 8, message: "Use at least 8 characters." }, shouldUnregister: true })} />
                    {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
                  </div>
                )}
                {captchaRequired && <Turnstile key={captchaKey} onToken={setCaptchaToken} />}
                {formError && (
                  <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm">
                    <p className="font-medium text-destructive">{formError.message}</p>
                    {formError.existingAccount && (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-bold">
                        <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => switchMode("login")}>
                          Log in instead
                        </button>
                        <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => switchMode("forgot")}>
                          Reset your password
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <Button type="submit" className="min-h-12 w-full rounded-xl" disabled={loading || (captchaRequired && !captchaToken)}>
                  {loading && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />}
                  {mode === "signup" ? "Create Account" : mode === "forgot" ? "Send reset link" : "Log In"}
                </Button>
                {mode === "forgot" && (
                  <Button type="button" variant="ghost" className="min-h-11 w-full rounded-xl" onClick={() => switchMode("login")}>
                    Back to log in
                  </Button>
                )}
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
