import { Link } from "react-router-dom"
import type { ReactNode } from "react"
import { APP_NAME, APP_INITIALS, APP_TAGLINE } from "@/lib/brand"

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border/80 bg-card/80 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link to="/" className="flex min-w-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
          </Link>
          <nav aria-label="Public" className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <Link
              to="/pricing"
              className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-bold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Pricing
            </Link>
            <Link
              to="/auth"
              className="inline-flex min-h-11 items-center rounded-xl border border-border bg-card px-4 text-sm font-bold shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Log in
            </Link>
            <Link
              to="/auth"
              state={{ mode: "signup" }}
              className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-black text-primary-foreground shadow-sm hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Start free
            </Link>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t border-border bg-card/50 px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-black">{APP_NAME}</p>
            <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
              Invoicing that stays simple. Your work stays yours.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold">
            <Link to="/pricing" className="text-muted-foreground hover:text-foreground">
              Pricing
            </Link>
            <Link to="/terms" className="text-muted-foreground hover:text-foreground">
              Terms
            </Link>
            <Link to="/privacy" className="text-muted-foreground hover:text-foreground">
              Privacy
            </Link>
            <Link to="/contact" className="text-muted-foreground hover:text-foreground">
              Contact
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
