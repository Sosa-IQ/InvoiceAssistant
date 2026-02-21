import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"
import "./index.css"
import AppLayout from "@/components/AppLayout"
import InvoicesPage from "@/pages/InvoicesPage"
import NewInvoicePage from "@/pages/NewInvoicePage"
import InvoiceEditorPage from "@/pages/InvoiceEditorPage"
import ClientsPage from "@/pages/ClientsPage"
import CatalogPage from "@/pages/CatalogPage"
import SettingsPage from "@/pages/SettingsPage"

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/invoices" replace /> },
      { path: "/invoices", element: <InvoicesPage /> },
      { path: "/invoices/new", element: <NewInvoicePage /> },
      { path: "/invoices/editor", element: <InvoiceEditorPage /> },
      { path: "/clients", element: <ClientsPage /> },
      { path: "/catalog", element: <CatalogPage /> },
      { path: "/settings", element: <SettingsPage /> },
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
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  </StrictMode>
)
