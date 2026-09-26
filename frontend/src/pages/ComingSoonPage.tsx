import { FileText, Mail, Mic, Sparkles } from "lucide-react"
import { APP_INITIALS, APP_NAME, APP_SUPPORT_EMAIL, APP_TAGLINE } from "@/lib/brand"

const HIGHLIGHTS = [
  {
    icon: FileText,
    title: "Clean invoices, fast",
    body: "Clients, a reusable catalog, and professional PDF export.",
  },
  {
    icon: Sparkles,
    title: "AI drafting",
    body: "Describe the work in plain language and get a ready-to-edit invoice.",
  },
  {
    icon: Mic,
    title: "Voice input",
    body: "Speak the job when your hands are full. Cuenvia writes it up.",
  },
  {
    icon: Mail,
    title: "Email delivery",
    body: "Send the PDF straight to your client and keep a simple history.",
  },
]

/** Pre-launch placeholder shown on every route when VITE_COMING_SOON is enabled. */
export default function ComingSoonPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border/80 bg-card/80 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <span
            aria-hidden="true"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary text-sm font-black text-primary-foreground shadow-sm"
          >
            {APP_INITIALS}
          </span>
          <div className="min-w-0">
            <p className="truncate font-black tracking-tight">{APP_NAME}</p>
            <p className="truncate text-xs text-muted-foreground">{APP_TAGLINE}</p>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="border-b border-border bg-[radial-gradient(circle_at_top,_rgba(255,107,85,0.12),_transparent_55%)] px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-6xl">
            <p className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-primary">
              Coming soon
            </p>
            <h1 className="mt-5 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">
              Invoices without the fuss.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              {APP_NAME} is a simple invoicing workspace for small businesses and independent pros. Create
              professional invoices in minutes, with AI and voice to help when you want it.
            </p>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              We are putting the finishing touches on version 1. Sign-ups open at launch.
            </p>
          </div>
        </section>

        <section className="px-4 py-14 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">What is coming</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {HIGHLIGHTS.map((item) => (
                <article key={item.title} className="h-full rounded-[24px] border border-border bg-card p-5 shadow-sm">
                  <item.icon className="h-6 w-6 text-primary" aria-hidden />
                  <h3 className="mt-4 text-lg font-black">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-card/50 px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:justify-between">
          <p>
            © {new Date().getFullYear()} {APP_NAME}
          </p>
          <p>
            Questions?{" "}
            <a href={`mailto:${APP_SUPPORT_EMAIL}`} className="font-bold text-foreground hover:underline">
              {APP_SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}
