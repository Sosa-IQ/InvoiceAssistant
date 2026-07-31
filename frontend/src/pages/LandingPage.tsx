import { Link, Navigate } from "react-router-dom"
import { ArrowRight, Clock3, FileText, Mail, Mic, Shield, Sparkles } from "lucide-react"
import { useAuth } from "@/auth/AuthContext"
import { PublicShell } from "@/components/PublicShell"
import { Button } from "@/components/ui/button"
import { APP_BLURB, APP_NAME } from "@/lib/brand"
import PageLoading from "@/components/PageLoading"

const STEPS = [
  {
    title: "Create the invoice",
    body: "Start from a blank form, or describe the work in plain language. Cuenvia fills in the details for you.",
  },
  {
    title: "Save a clean PDF",
    body: "Export a professional invoice you can download anytime. Free covers the basics with no card required.",
  },
  {
    title: "Send when you are ready",
    body: "With Pro, email the invoice, use voice, and let AI help revise drafts — all from one calm workspace.",
  },
]

const FEATURES = [
  {
    icon: FileText,
    title: "Free forever basics",
    body: "Invoices, clients, catalog, and PDF export. No timer that kicks you out.",
  },
  {
    icon: Sparkles,
    title: "Pro AI drafting",
    body: "Generate or update drafts with text or voice. Usage is metered clearly — no mystery counters.",
  },
  {
    icon: Mail,
    title: "Email delivery",
    body: "Send the PDF to your client and keep a simple history of what went out.",
  },
  {
    icon: Mic,
    title: "Voice when hands are full",
    body: "Speak the work you did. Cuenvia turns it into invoice language you can edit.",
  },
  {
    icon: Shield,
    title: "Your data stays yours",
    body: "Each account is private. We do not sell your invoices or client list.",
  },
  {
    icon: Clock3,
    title: "Get paid with less admin",
    body: "Spend time on the work, not wrestling spreadsheets or hunting last month’s PDF.",
  },
]

export default function LandingPage() {
  const { user, loading } = useAuth()

  if (loading) return <PageLoading />
  if (user) return <Navigate to="/invoices" replace />

  return (
    <PublicShell>
      <section className="border-b border-border bg-[radial-gradient(circle_at_top,_rgba(255,107,85,0.12),_transparent_55%)] px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm font-black uppercase tracking-[0.16em] text-primary">{APP_NAME}</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">
            Invoices without the fuss.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">{APP_BLURB}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild className="min-h-12 rounded-xl px-6 text-base font-black">
              <Link to="/auth">
                Start free
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="min-h-12 rounded-xl px-6 text-base font-bold">
              <Link to="/pricing">See pricing</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">No credit card for Free. Upgrade only if you want Pro tools.</p>
        </div>
      </section>

      <section className="px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-2xl font-black tracking-tight sm:text-3xl">Three calm steps</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <article key={step.title} className="rounded-[28px] border border-border bg-card p-6 shadow-sm">
                <p className="text-sm font-black text-primary">Step {index + 1}</p>
                <h3 className="mt-3 text-xl font-black">{step.title}</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-muted/30 px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-2xl font-black tracking-tight sm:text-3xl">Built for real small businesses</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <article key={feature.title} className="h-full rounded-[24px] border border-border bg-card p-5 shadow-sm">
                <feature.icon className="h-6 w-6 text-primary" aria-hidden />
                <h3 className="mt-4 text-lg font-black">{feature.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-6xl rounded-[32px] border border-border bg-card p-8 text-center shadow-sm sm:p-12">
          <h2 className="text-3xl font-black tracking-tight">Ready when you are</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Create your free {APP_NAME} workspace in a minute. Add Pro later for AI, voice, and email.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild className="min-h-12 rounded-xl px-6 font-black">
              <Link to="/auth">Create free account</Link>
            </Button>
            <Button asChild variant="outline" className="min-h-12 rounded-xl px-6 font-bold">
              <Link to="/contact">Questions? Contact us</Link>
            </Button>
          </div>
        </div>
      </section>
    </PublicShell>
  )
}
