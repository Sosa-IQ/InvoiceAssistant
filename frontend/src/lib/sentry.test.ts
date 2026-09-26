import { scrubEvent, scrubUrl } from "./sentry"

it("removes recovery tokens, identity, and console output from events", () => {
  const event = scrubEvent({
    request: {
      url: "https://cuenvia.com/reset-password#access_token=secret&type=recovery",
      query_string: "a=1",
      headers: { Authorization: "Bearer x" },
      data: "invoice body",
    },
    user: { id: "user-1", email: "owner@example.com" },
    breadcrumbs: [
      { category: "console", data: { arguments: ["client: Acme"] } },
      { category: "navigation", data: { from: "/auth?next=1", to: "/reset-password#access_token=secret" } },
      { category: "fetch", data: { url: "https://api.cuenvia.com/api/invoices?search=acme" } },
    ],
  })

  expect(event.request).toEqual({ url: "https://cuenvia.com/reset-password" })
  expect(event.user).toBeUndefined()
  expect(event.breadcrumbs).toEqual([
    { category: "navigation", data: { from: "/auth", to: "/reset-password" } },
    { category: "fetch", data: { url: "https://api.cuenvia.com/api/invoices" } },
  ])
  expect(scrubUrl(undefined)).toBeUndefined()
})
