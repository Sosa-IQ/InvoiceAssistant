import { beforeEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { AuthContext } from "@/auth/AuthContext"
import { mockAuthValue } from "@/test/utils"
import AuthPage from "./AuthPage"

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  missingSupabaseEnvVars: [],
  supabase: {
    auth: {
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
  },
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { supabase } from "@/lib/supabase"

function renderAuth(state?: unknown) {
  return render(
    <AuthContext.Provider value={mockAuthValue({ user: null })}>
      <MemoryRouter initialEntries={[{ pathname: "/auth", state }]}>
        <AuthPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe("AuthPage", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sends a reset link to /reset-password without revealing whether the account exists", async () => {
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue({ data: {}, error: null })
    renderAuth()

    await userEvent.click(screen.getByRole("button", { name: "Forgot password?" }))
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText("Email"), "someone@example.com")
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }))

    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith("someone@example.com", {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    expect(await screen.findByText("Check your email")).toBeInTheDocument()
    expect(screen.getByText(/If an account exists for/)).toBeInTheDocument()
  })

  it("asks the user to confirm their email when signup returns no session", async () => {
    vi.mocked(supabase.auth.signUp).mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    } as unknown as Awaited<ReturnType<typeof supabase.auth.signUp>>)
    renderAuth({ mode: "signup" })

    expect(screen.getByRole("button", { name: "Create Account" })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText("Email"), "new@example.com")
    await userEvent.type(screen.getByLabelText("Password"), "a-strong-password")
    await userEvent.click(screen.getByRole("button", { name: "Create Account" }))

    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "a-strong-password",
      options: { emailRedirectTo: `${window.location.origin}/invoices` },
    })
    expect(await screen.findByText(/We sent a confirmation link to/)).toBeInTheDocument()
  })
})
