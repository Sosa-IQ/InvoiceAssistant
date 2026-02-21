import { NavLink, Outlet } from "react-router-dom"
import {
  FileText,
  PlusCircle,
  Users,
  Package,
  Settings,
} from "lucide-react"
import { cn } from "@/lib/utils"

const NAV = [
  { to: "/invoices", icon: FileText, label: "Invoices" },
  { to: "/invoices/new", icon: PlusCircle, label: "New Invoice" },
  { to: "/clients", icon: Users, label: "Clients" },
  { to: "/catalog", icon: Package, label: "Catalog" },
  { to: "/settings", icon: Settings, label: "Settings" },
]

export default function AppLayout() {
  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 flex flex-col border-r border-border bg-sidebar">
        <div className="h-14 flex items-center px-4 border-b border-border">
          <span className="font-semibold text-sm tracking-wide text-sidebar-foreground">
            Invoice Assistant
          </span>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/invoices"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
