import { vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { AuthContext } from "@/auth/AuthContext"
import { mockAuthValue, mockUser } from "@/test/utils"
import ResetPasswordPage from "./ResetPasswordPage"

const redirect = vi.hoisted(() => ({ recovery: false, error: null as string | null }))
vi.mock("@/lib/supabase", () => ({
  initialAuthRedirect: redirect,
  supabase: { auth: { updateUser: vi.fn() } },
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function renderPage(passwordRecovery: boolean) {
  return render(
    <AuthContext.Provider value={mockAuthValue({ user: mockUser(), passwordRecovery })}>
      <MemoryRouter>
        <ResetPasswordPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  redirect.recovery = false
  redirect.error = null
})

it("offers the new-password form for a recovery session", () => {
  renderPage(true)
  expect(screen.getByText("Choose a new password")).toBeInTheDocument()
})

it("never offers the form to someone who is merely signed in", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  renderPage(false)
  await vi.advanceTimersByTimeAsync(5000)
  expect(await screen.findByText("This link is invalid or expired")).toBeInTheDocument()
  expect(screen.queryByText("Choose a new password")).not.toBeInTheDocument()
  vi.useRealTimers()
})

it("rejects an already-used or expired link right away", () => {
  redirect.error = "otp_expired"
  renderPage(true)
  expect(screen.getByText("This link is invalid or expired")).toBeInTheDocument()
})
