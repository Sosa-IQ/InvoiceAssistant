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
import ComingSoonPage from "@/pages/ComingSoonPage"

// Pre-launch: set VITE_COMING_SOON=true (Vercel Production) to serve only the placeholder page.
const COMING_SOON = import.meta.env.VITE_COMING_SOON === "true"

const LandingPage = lazy(() => import("@/pages/LandingPage"))
const AuthPage = lazy(() => import("@/pages/AuthPage"))
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage"))
const PricingPage = lazy(() => import("@/pages/PricingPage"))
const TermsPage = lazy(() => import("@/pages/TermsPage"))
const PrivacyPage = lazy(() => import("@/pages/PrivacyPage"))
const ContactPage = lazy(() => import("@/pages/ContactPage"))
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
  { path: "/", element: deferred(<LandingPage />) },
  { path: "/auth", element: deferred(<AuthPage />) },
  { path: "/reset-password", element: deferred(<ResetPasswordPage />) },
  { path: "/pricing", element: deferred(<PricingPage />) },
  { path: "/terms", element: deferred(<TermsPage />) },
  { path: "/privacy", element: deferred(<PrivacyPage />) },
  { path: "/contact", element: deferred(<ContactPage />) },
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
              { path: "/invoices", element: deferred(<InvoicesPage />) },
              { path: "/invoices/new", element: deferred(<NewInvoicePage />) },
              { path: "/invoices/editor", element: deferred(<InvoiceEditorPage />) },
              { path: "/clients", element: deferred(<ClientsPage />) },
              { path: "/catalog", element: deferred(<CatalogPage />) },
              { path: "/settings", element: deferred(<SettingsPage />) },
              { path: "/billing", element: deferred(<BillingPage />) },
              { path: "*", element: <Navigate to="/invoices" replace /> },
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
  COMING_SOON ? (
    <StrictMode>
      <ComingSoonPage />
    </StrictMode>
  ) : (
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
  ),
)
