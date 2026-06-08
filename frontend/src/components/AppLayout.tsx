import { useEffect, useState } from "react"
import { NavLink, Outlet } from "react-router-dom"
import { FileText, LogOut, Moon, Package, PlusCircle, Settings, Sun, Users } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/auth/AuthProvider"
import { cn } from "@/lib/utils"

const NAV = [
  { to: "/invoices",     icon: FileText,   label: "Invoices" },
  { to: "/invoices/new", icon: PlusCircle, label: "New Invoice" },
  { to: "/clients",      icon: Users,      label: "Clients" },
  { to: "/catalog",      icon: Package,    label: "Catalog" },
  { to: "/settings",     icon: Settings,   label: "Settings" },
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

  return [dark, () => setDark((d) => !d)] as const
}

export default function AppLayout() {
  const [dark, toggleDark] = useDarkMode()
  const { user, signOut } = useAuth()

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 flex flex-col border-r border-sidebar-border bg-sidebar">
        {/* Brand */}
        <div className="h-14 flex items-center px-5 border-b border-sidebar-border">
          <span className="font-semibold text-[13px] tracking-tight text-sidebar-foreground select-none">
            Invoice Assistant
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/invoices"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                )
              }
            >
              <Icon className="h-3.75 w-3.75 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-3 border-t border-sidebar-border text-xs text-sidebar-foreground/70">
          <div className="truncate font-medium text-sidebar-foreground">{user?.email}</div>
        </div>

        {/* Footer controls */}
        <div className="p-3 border-t border-sidebar-border">
          <button
            onClick={toggleDark}
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            {dark
              ? <Sun  className="h-3.75 w-3.75 shrink-0" />
              : <Moon className="h-3.75 w-3.75 shrink-0" />}
            {dark ? "Light mode" : "Dark mode"}
          </button>
          <button
            onClick={async () => {
              await signOut()
              toast.success("Signed out.")
            }}
            className="mt-2 w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <LogOut className="h-3.75 w-3.75 shrink-0" />
            Log out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
