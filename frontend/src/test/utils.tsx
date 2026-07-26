import type { ReactElement, ReactNode } from "react"
import { render, type RenderOptions } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import type { Session, User } from "@supabase/supabase-js"
import { AuthContext, type AuthContextValue } from "@/auth/AuthContext"

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

/** A minimal Supabase-shaped user, enough for components that read `user.email`. */
export function mockUser(email = "owner@example.com"): User {
  return { id: "user-1", email } as unknown as User
}

export function mockAuthValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    session: null as Session | null,
    user: mockUser(),
    loading: false,
    signOut: async () => {},
    ...overrides,
  }
}

type ProviderOptions = {
  auth?: Partial<AuthContextValue>
  queryClient?: QueryClient
  initialEntries?: string[]
} & Omit<RenderOptions, "wrapper">

export function renderWithProviders(ui: ReactElement, options: ProviderOptions = {}) {
  const { auth, queryClient = makeQueryClient(), initialEntries = ["/"], ...rest } = options
  const authValue = mockAuthValue(auth)

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authValue}>
          <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    )
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...rest }) }
}
