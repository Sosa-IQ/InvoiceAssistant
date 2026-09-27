import "@testing-library/jest-dom/vitest"

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// Node 25+ defines its own global `localStorage`, which is undefined unless Node runs with
// --localstorage-file, and it shadows jsdom's. Provide an in-memory Storage when that happens.
if (typeof globalThis.localStorage?.getItem !== "function") {
  class MemoryStorage implements Storage {
    private items = new Map<string, string>()
    get length() {
      return this.items.size
    }
    clear() {
      this.items.clear()
    }
    getItem(key: string) {
      return this.items.get(key) ?? null
    }
    key(index: number) {
      return [...this.items.keys()][index] ?? null
    }
    removeItem(key: string) {
      this.items.delete(key)
    }
    setItem(key: string, value: string) {
      this.items.set(key, String(value))
    }
  }
  for (const name of ["localStorage", "sessionStorage"] as const) {
    const storage = new MemoryStorage()
    Object.defineProperty(globalThis, name, { configurable: true, value: storage })
    Object.defineProperty(window, name, { configurable: true, value: storage })
  }
}
