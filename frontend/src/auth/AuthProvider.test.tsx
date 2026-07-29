import { useEffect, useState } from "react"
import { afterEach, beforeEach, vi } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AuthChangeEvent, Session } from "@supabase/supabase-js"
import { AuthProvider } from "./AuthProvider"
import { useAuth } from "./AuthContext"

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
    },
  },
}))

vi.mock("@/api/auth", () => ({
  getCurrentUserProfile: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { supabase } from "@/lib/supabase"
import { getCurrentUserProfile } from "@/api/auth"

function makeSession(userId: string): Session {
  return {
    access_token: `token-${userId}`,
    refresh_token: `refresh-${userId}`,
    expires_in: 3600,
    token_type: "bearer",
    user: { id: userId, email: `${userId}@example.com` },
  } as unknown as Session
}

let mountCount = 0
let unmountedAfterMount = false

/** Mimics RequireAuth: unmounts its child tree whenever `loading` is true. */
function RequireAuthLike() {
  const { loading } = useAuth()
  if (loading) return <div>Loading…</div>
  return <MountProbe />
}

function MountProbe() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    mountCount += 1
    return () => {
      unmountedAfterMount = true
    }
  }, [])
  return (
    <div>
      <span data-testid="probe-count">{count}</span>
      <button onClick={() => setCount((c) => c + 1)}>increment</button>
    </div>
  )
}

function renderAuthProvider() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RequireAuthLike />
      </AuthProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mountCount = 0
  unmountedAfterMount = false
  vi.mocked(getCurrentUserProfile).mockResolvedValue({
    user: { id: "user-1", email: "user-1@example.com", display_name: null, created_at: null },
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("AuthProvider — same-user auth events must not unmount children", () => {
  it("survives a same-user TOKEN_REFRESHED event without unmounting mounted children or losing state", async () => {
    const session = makeSession("user-1")
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session },
      error: null,
    } as never)

    let capturedCallback: ((event: AuthChangeEvent, session: Session | null) => void) | null = null
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((callback) => {
      capturedCallback = callback
      return { data: { subscription: { unsubscribe: vi.fn() } } } as never
    })

    const user = userEvent.setup()
    renderAuthProvider()

    // Initial bootstrap loads once.
    await waitFor(() => expect(screen.getByTestId("probe-count")).toBeInTheDocument())
    expect(mountCount).toBe(1)

    await user.click(screen.getByRole("button", { name: "increment" }))
    await user.click(screen.getByRole("button", { name: "increment" }))
    expect(screen.getByTestId("probe-count")).toHaveTextContent("2")

    expect(capturedCallback).not.toBeNull()

    // The follow-up profile fetch triggered by the auth event must not resolve
    // synchronously, matching the real network gap that exposes the bug: if
    // `setLoading(true)` fires, React commits that render before this promise
    // ever settles.
    let resolveProfile!: (value: Awaited<ReturnType<typeof getCurrentUserProfile>>) => void
    vi.mocked(getCurrentUserProfile).mockImplementation(
      () => new Promise((resolve) => { resolveProfile = resolve }),
    )

    // A same-user token refresh must not flip global loading or unmount the tree.
    act(() => {
      capturedCallback!("TOKEN_REFRESHED", makeSession("user-1"))
    })

    expect(screen.queryByText("Loading…")).not.toBeInTheDocument()
    expect(screen.getByTestId("probe-count")).toHaveTextContent("2")
    expect(mountCount).toBe(1)
    expect(unmountedAfterMount).toBe(false)

    // Let the in-flight profile fetch settle and confirm nothing changes.
    await act(async () => {
      resolveProfile({
        user: { id: "user-1", email: "user-1@example.com", display_name: null, created_at: null },
      })
    })

    expect(screen.queryByText("Loading…")).not.toBeInTheDocument()
    expect(screen.getByTestId("probe-count")).toHaveTextContent("2")
    expect(mountCount).toBe(1)
    expect(unmountedAfterMount).toBe(false)
  })

  it("keeps loading and does not remount when an older same-user refresh resolves before a newer identity bootstrap", async () => {
    const session = makeSession("user-1")
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session },
      error: null,
    } as never)

    let capturedCallback: ((event: AuthChangeEvent, session: Session | null) => void) | null = null
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((callback) => {
      capturedCallback = callback
      return { data: { subscription: { unsubscribe: vi.fn() } } } as never
    })

    renderAuthProvider()

    await waitFor(() => expect(screen.getByTestId("probe-count")).toBeInTheDocument())
    expect(mountCount).toBe(1)

    // Each bootstrap now gets its own pending profile fetch so we can settle the
    // older same-user request before the newer identity request.
    const resolvers: Array<(value: Awaited<ReturnType<typeof getCurrentUserProfile>>) => void> = []
    vi.mocked(getCurrentUserProfile).mockImplementation(
      () => new Promise((resolve) => { resolvers.push(resolve) }),
    )

    // Older, same-user TOKEN_REFRESHED: starts a profile fetch, no loading toggle.
    act(() => {
      capturedCallback!("TOKEN_REFRESHED", makeSession("user-1"))
    })
    // Newer, real identity change: shows loading and unmounts the protected child.
    act(() => {
      capturedCallback!("SIGNED_IN", makeSession("user-2"))
    })

    expect(screen.getByText("Loading…")).toBeInTheDocument()
    expect(unmountedAfterMount).toBe(true)
    expect(resolvers).toHaveLength(2)

    // Resolve the OLDER same-user request first. A stale bootstrap must not clear
    // global loading or remount the protected child.
    await act(async () => {
      resolvers[0]({
        user: { id: "user-1", email: "user-1@example.com", display_name: null, created_at: null },
      })
    })

    expect(screen.getByText("Loading…")).toBeInTheDocument()
    expect(mountCount).toBe(1)

    // Only the newest identity bootstrap resolving clears loading and remounts.
    await act(async () => {
      resolvers[1]({
        user: { id: "user-2", email: "user-2@example.com", display_name: null, created_at: null },
      })
    })

    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument())
    expect(mountCount).toBe(2)
  })

  it("still shows loading and unmounts children when the user identity actually changes", async () => {
    const session = makeSession("user-1")
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session },
      error: null,
    } as never)

    let capturedCallback: ((event: AuthChangeEvent, session: Session | null) => void) | null = null
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation((callback) => {
      capturedCallback = callback
      return { data: { subscription: { unsubscribe: vi.fn() } } } as never
    })

    renderAuthProvider()

    await waitFor(() => expect(screen.getByTestId("probe-count")).toBeInTheDocument())
    expect(mountCount).toBe(1)

    let resolveProfile!: (value: Awaited<ReturnType<typeof getCurrentUserProfile>>) => void
    vi.mocked(getCurrentUserProfile).mockImplementation(
      () => new Promise((resolve) => { resolveProfile = resolve }),
    )

    act(() => {
      capturedCallback!("SIGNED_IN", makeSession("user-2"))
    })

    expect(screen.getByText("Loading…")).toBeInTheDocument()

    await act(async () => {
      resolveProfile({
        user: { id: "user-2", email: "user-2@example.com", display_name: null, created_at: null },
      })
    })

    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument())
    expect(mountCount).toBe(2)
  })
})
