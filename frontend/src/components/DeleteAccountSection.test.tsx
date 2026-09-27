import { vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { AuthContext } from "@/auth/AuthContext"
import { mockAuthValue } from "@/test/utils"
import { DeleteAccountSection } from "./DeleteAccountSection"

vi.mock("@/api/auth", () => ({ deleteAccount: vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { deleteAccount } from "@/api/auth"

it("only deletes after the account email is typed, then signs out and leaves the app", async () => {
  vi.mocked(deleteAccount).mockResolvedValue()
  const signOut = vi.fn().mockResolvedValue(undefined)
  render(
    <AuthContext.Provider value={mockAuthValue({ signOut })}>
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/settings" element={<DeleteAccountSection />} />
          <Route path="/" element={<p>home page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )

  await userEvent.click(screen.getByRole("button", { name: "Delete account" }))
  const confirm = screen.getByRole("button", { name: "Delete forever" })
  expect(confirm).toBeDisabled()

  await userEvent.type(screen.getByLabelText(/to confirm/), "wrong@example.com")
  expect(confirm).toBeDisabled()

  await userEvent.clear(screen.getByLabelText(/to confirm/))
  await userEvent.type(screen.getByLabelText(/to confirm/), "Owner@Example.com")
  await userEvent.click(confirm)

  expect(deleteAccount).toHaveBeenCalledWith("Owner@Example.com")
  expect(signOut).toHaveBeenCalled()
  expect(await screen.findByText("home page")).toBeInTheDocument()
})
