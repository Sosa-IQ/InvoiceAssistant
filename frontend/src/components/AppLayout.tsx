import { useEffect, useState } from "react"
import { NavLink, Outlet } from "react-router-dom"
import { FileText, LogOut, Moon, Package, PlusCircle, Settings, Sun, Users } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/auth/AuthContext"
import { cn } from "@/lib/utils"

const NAV = [
  { to: "/invoices", icon: FileText, label: "Invoices" },
  { to: "/invoices/new", icon: PlusCircle, label: "New Invoice" },
  { to: "/clients", icon: Users, label: "Clients" },
  { to: "/catalog", icon: Package, label: "Catalog" },
  { to: "/settings", icon: Settings, label: "Settings" },
]

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

export default function AppLayout() {
  const [dark, toggleDark] = useDarkMode()
  const { user, signOut } = useAuth()

  const signOutNow = async () => {
    await signOut()
    toast.success("Signed out.")
  }

  return (
    <div className="flex min-h-dvh bg-background text-foreground md:h-screen md:overflow-hidden">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-14 items-center border-b border-sidebar-border px-5">
          <span className="select-none text-[13px] font-semibold tracking-tight text-sidebar-foreground">Invoice Assistant</span>
        </div>
        <nav aria-label="Primary navigation" className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/invoices"}
              className={({ isActive }) => cn(
                "flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-sidebar-border px-4 py-3 text-xs text-sidebar-foreground/70">
          <div className="truncate font-medium text-sidebar-foreground">{user?.email}</div>
        </div>
        <div className="border-t border-sidebar-border p-3">
          <button type="button" onClick={toggleDark} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} className="flex min-h-10 w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {dark ? <Sun aria-hidden="true" className="h-4 w-4" /> : <Moon aria-hidden="true" className="h-4 w-4" />}
            {dark ? "Light mode" : "Dark mode"}
          </button>
          <button type="button" onClick={() => void signOutNow()} className="mt-2 flex min-h-10 w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <LogOut aria-hidden="true" className="h-4 w-4" /> Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:hidden">
          <span className="text-sm font-semibold">Invoice Assistant</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={toggleDark} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} className="grid min-h-11 min-w-11 place-items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {dark ? <Sun aria-hidden="true" className="h-5 w-5" /> : <Moon aria-hidden="true" className="h-5 w-5" />}
            </button>
            <button type="button" onClick={() => void signOutNow()} aria-label="Log out" className="grid min-h-11 min-w-11 place-items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <LogOut aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main id="main-content" className="min-w-0 flex-1 overflow-y-auto pb-24 md:pb-0">
          <Outlet />
        </main>

        <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === "/invoices"} className={({ isActive }) => cn("flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", isActive ? "text-primary" : "text-muted-foreground")}>
              <Icon aria-hidden="true" className="h-5 w-5" />
              <span className="max-w-full truncate">{label === "New Invoice" ? "New" : label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
