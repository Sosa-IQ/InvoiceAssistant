import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { vi } from "vitest"

import { renderWithProviders } from "@/test/utils"
import AppLayout from "./AppLayout"


describe("AppLayout mobile controls", () => {
  it("provides a mobile-header logout control", async () => {
    const user = userEvent.setup()
    const signOut = vi.fn().mockResolvedValue(undefined)
    renderWithProviders(<AppLayout />, { auth: { signOut } })

    const logoutButtons = screen.getAllByRole("button", { name: "Log out" })
    expect(logoutButtons).toHaveLength(2)

    await user.click(logoutButtons[1])
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
