import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { KeyRound, Loader2 } from "lucide-react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/auth/AuthContext"
import { supabase } from "@/lib/supabase"
import { APP_INITIALS, APP_NAME } from "@/lib/brand"
import PageLoading from "@/components/PageLoading"

type ResetFormData = {
  password: string
  confirm: string
}

// How long to wait for Supabase to exchange the recovery link before calling it invalid.
const LINK_GRACE_MS = 4000

/**
 * Landing page for the password-recovery email link. Supabase turns the link's token into a
 * session, so a signed-in user here can set a new password.
 */
export default function ResetPasswordPage() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [linkExpired, setLinkExpired] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetFormData>()

  useEffect(() => {
    if (user) return
    const timer = window.setTimeout(() => setLinkExpired(true), LINK_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [user])

  async function onSubmit(values: ResetFormData) {
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: values.password })
      if (error) throw error
      toast.success("Password updated.")
      navigate("/invoices", { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update your password.")
    } finally {
      setSaving(false)
    }
  }

  if (!user && (authLoading || !linkExpired)) return <PageLoading />

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 py-8">
      <section className="w-full max-w-md rounded-[28px] border bg-card p-6 shadow-[0_20px_55px_rgba(24,58,50,0.09)] sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-2xl bg-primary text-sm font-black text-primary-foreground">
            {APP_INITIALS}
          </span>
          <p className="font-black">{APP_NAME}</p>
        </div>

        {!user ? (
          <div className="space-y-4">
            <h1 className="text-xl font-black">This link is invalid or expired</h1>
            <p className="text-sm leading-6 text-muted-foreground">Reset links can only be used once and expire after a short time. Request a new one to continue.</p>
            <Button asChild className="min-h-11 w-full rounded-xl">
              <Link to="/auth">Back to log in</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-1.5">
              <h1 className="flex items-center gap-2 text-xl font-black">
                <KeyRound aria-hidden="true" className="h-5 w-5 text-primary" />
                Choose a new password
              </h1>
              <p className="break-all text-sm text-muted-foreground">For {user.email}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reset-password">New password</Label>
              <Input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.password)}
                {...register("password", { required: true, minLength: 8 })}
              />
              {errors.password && <p className="text-sm text-destructive">Use at least 8 characters.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reset-confirm">Confirm new password</Label>
              <Input
                id="reset-confirm"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.confirm)}
                {...register("confirm", {
                  required: true,
                  validate: (value, all) => value === all.password,
                })}
              />
              {errors.confirm && <p className="text-sm text-destructive">Passwords do not match.</p>}
            </div>
            <Button type="submit" className="min-h-12 w-full rounded-xl" disabled={saving}>
              {saving && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />}
              Update password
            </Button>
          </form>
        )}
      </section>
    </div>
  )
}
