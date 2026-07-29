import { useEffect, useState } from "react"
import { NavLink, Outlet } from "react-router-dom"
import { CreditCard, FileText, LogOut, Moon, Package, PlusCircle, Settings, Sun, Users } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/auth/AuthContext"
import { cn } from "@/lib/utils"

const MAIN_NAV = [
  { to: "/invoices", icon: FileText, label: "Invoices" },
  { to: "/invoices/new", icon: PlusCircle, label: "New invoice" },
  { to: "/clients", icon: Users, label: "Clients" },
  { to: "/catalog", icon: Package, label: "Catalog" },
]
const ACCOUNT_NAV = [
  { to: "/settings", icon: Settings, label: "Settings" },
  { to: "/billing", icon: CreditCard, label: "Plan and billing" },
]
const MOBILE_NAV = [...MAIN_NAV, ACCOUNT_NAV[0]]

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem("theme")
    if (stored) return stored === "dark"
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    localStorage.setItem("theme", dark ? "dark" : "light")
  }, [dark])

  return [dark, () => setDark((value) => !value)] as const
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-primary text-sm font-black text-primary-foreground shadow-sm">IA</span>
      <div className={cn("min-w-0", compact && "hidden min-[360px]:block")}>
        <p className="truncate text-sm font-black tracking-tight">Invoice Assistant</p>
        <p className="truncate text-[11px] text-muted-foreground">Simple invoicing</p>
      </div>
    </div>
  )
}

function DesktopLink({ to, icon: Icon, label }: { to: string; icon: typeof FileText; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/invoices"}
      className={({ isActive }) => cn(
        "flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isActive ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
    >
      <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
      {label}
    </NavLink>
  )
}

export default function AppLayout() {
  const [dark, toggleDark] = useDarkMode()
  const { user, signOut } = useAuth()

  const signOutNow = async () => {
    await signOut()
    toast.success("Signed out.")
  }

  return (
    <div className="flex min-h-dvh bg-background text-foreground md:h-screen md:overflow-hidden">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="border-b border-sidebar-border px-5 py-5"><Brand /></div>
        <nav aria-label="Primary navigation" className="flex-1 space-y-1 overflow-y-auto p-3">
          <p className="px-3 pb-1 pt-2 text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">Workspace</p>
          {MAIN_NAV.map((item) => <DesktopLink key={item.to} {...item} />)}
          <p className="px-3 pb-1 pt-5 text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">Account</p>
          {ACCOUNT_NAV.map((item) => <DesktopLink key={item.to} {...item} />)}
        </nav>
        <div className="border-t border-sidebar-border px-4 py-3">
          <p className="truncate text-xs font-bold text-sidebar-foreground">{user?.email}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Signed in</p>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-sidebar-border p-3">
          <button type="button" onClick={toggleDark} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} className="flex min-h-11 items-center justify-center gap-2 rounded-xl text-xs font-bold text-sidebar-foreground/70 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {dark ? <Sun aria-hidden="true" className="h-4 w-4" /> : <Moon aria-hidden="true" className="h-4 w-4" />}
            Theme
          </button>
          <button type="button" onClick={() => void signOutNow()} aria-label="Log out" className="flex min-h-11 items-center justify-center gap-2 rounded-xl text-xs font-bold text-sidebar-foreground/70 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <LogOut aria-hidden="true" className="h-4 w-4" /> Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between border-b bg-card/95 px-4 backdrop-blur md:hidden">
          <Brand compact />
          <div className="flex items-center gap-1">
            <button type="button" onClick={toggleDark} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} className="grid min-h-11 min-w-11 place-items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {dark ? <Sun aria-hidden="true" className="h-5 w-5" /> : <Moon aria-hidden="true" className="h-5 w-5" />}
            </button>
            <button type="button" onClick={() => void signOutNow()} aria-label="Log out" className="grid min-h-11 min-w-11 place-items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <LogOut aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main id="main-content" className="min-w-0 flex-1 overflow-y-auto pb-24 md:pb-0">
          <Outlet />
        </main>

        <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-card/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_28px_rgba(24,58,50,0.08)] backdrop-blur md:hidden">
          {MOBILE_NAV.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === "/invoices"} className={({ isActive }) => cn("relative flex min-h-[68px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", isActive ? "text-foreground" : "text-muted-foreground")}>
              {({ isActive }) => (
                <>
                  {isActive && <span aria-hidden="true" className="absolute top-1.5 h-1 w-7 rounded-full bg-[#b8dc72]" />}
                  <Icon aria-hidden="true" className="h-5 w-5" />
                  <span className="max-w-full truncate">{label === "New invoice" ? "New" : label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
