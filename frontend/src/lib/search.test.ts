import { matchesSearch } from "./search"

it("matches every word, case-insensitively, across fields", () => {
  expect(matchesSearch("", ["Acme"])).toBe(true)
  expect(matchesSearch("acme main", ["Acme Corp", null, "12 Main St"])).toBe(true)
  expect(matchesSearch("acme elm", ["Acme Corp", "12 Main St"])).toBe(false)
})
