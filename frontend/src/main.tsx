import { lazy, StrictMode, Suspense, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"
import "./index.css"
import { AuthProvider } from "@/auth/AuthProvider"
import OnboardingGate from "@/auth/OnboardingGate"
import RequireAuth from "@/auth/RequireAuth"
import AppLayout from "@/components/AppLayout"
import AppErrorBoundary from "@/components/AppErrorBoundary"
import PageLoading from "@/components/PageLoading"

const AuthPage = lazy(() => import("@/pages/AuthPage"))
const PricingPage = lazy(() => import("@/pages/PricingPage"))
const OnboardingPage = lazy(() => import("@/pages/OnboardingPage"))
const BillingPage = lazy(() => import("@/pages/BillingPage"))
const InvoicesPage = lazy(() => import("@/pages/InvoicesPage"))
const NewInvoicePage = lazy(() => import("@/pages/NewInvoicePage"))
const InvoiceEditorPage = lazy(() => import("@/pages/InvoiceEditorPage"))
const ClientsPage = lazy(() => import("@/pages/ClientsPage"))
const CatalogPage = lazy(() => import("@/pages/CatalogPage"))
const SettingsPage = lazy(() => import("@/pages/SettingsPage"))

function deferred(node: ReactNode) {
  return <Suspense fallback={<PageLoading />}>{node}</Suspense>
}

const router = createBrowserRouter([
  { path: "/auth", element: deferred(<AuthPage />) },
  { path: "/pricing", element: deferred(<PricingPage />) },
  {
    element: <RequireAuth />,
    children: [
      { path: "/onboarding", element: deferred(<OnboardingPage />) },
      {
        element: <OnboardingGate />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <Navigate to="/invoices" replace /> },
              { path: "/invoices", element: deferred(<InvoicesPage />) },
              { path: "/invoices/new", element: deferred(<NewInvoicePage />) },
              { path: "/invoices/editor", element: deferred(<InvoiceEditorPage />) },
              { path: "/clients", element: deferred(<ClientsPage />) },
              { path: "/catalog", element: deferred(<CatalogPage />) },
              { path: "/settings", element: deferred(<SettingsPage />) },
              { path: "/billing", element: deferred(<BillingPage />) },
            ],
          },
        ],
      },
    ],
  },
])

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
          <Toaster richColors position="top-right" />
        </AuthProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>
)
