import { screen } from "@testing-library/react"
import { beforeEach, vi } from "vitest"
import { renderWithProviders } from "@/test/utils"
import LandingPage from "./LandingPage"

vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext")
  return {
    ...actual,
    useAuth: () => ({ user: null, loading: false, signOut: vi.fn() }),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("LandingPage", () => {
  it("shows Cuenvia hero and primary free CTA", () => {
    renderWithProviders(<LandingPage />, { auth: { user: null }, initialEntries: ["/"] })
    expect(screen.getByRole("heading", { name: /Invoices without the fuss/i })).toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: /Start free|Create free account/i }).length).toBeGreaterThan(0)
    expect(screen.getByRole("link", { name: /See pricing/i })).toBeInTheDocument()
  })
})
