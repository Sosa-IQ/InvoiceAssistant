import assert from "node:assert/strict"
import test from "node:test"

import { scanSource } from "./check-rsc-not-used.mjs"

const rejected = [
  ["static import", 'import { unstable_createCallServer } from "react-router/dom"'],
  ["root import", 'import * as Router from "react-router"'],
  ["re-export", 'export { unstable_RSCStaticRouter } from "react-router"'],
  ["dynamic import", 'const router = await import("react-router/dom")'],
  ["require", 'const router = require("@react-router/node")'],
  ["namespace access", 'Router.unstable_createCallServer()'],
  ["computed access", 'Router["unstable_createCallServer"]()'],
  ["template dynamic import", "await import(`react-router/dom`)"],
  ["template require", "require(`@react-router/node`)"],
  ["dynamic import with options", "await import(`react-router/dom`, {})"],
  ["require with an extra argument", "require(`@react-router/node`, 0)"],
  ["template computed access", "Router[`unstable_createCallServer`]()"],
  ["server package", 'import "react-server-dom-webpack/client"'],
]

for (const [name, source] of rejected) {
  test(`RSC guard rejects ${name}`, () => {
    assert.notEqual(scanSource("src/example.ts", source).failures.length, 0)
  })
}

test("RSC guard allows the client SPA router", () => {
  const source = 'import { createBrowserRouter } from "react-router-dom"; import { createRoot } from "react-dom/client"'
  const result = scanSource("src/main.tsx", source)
  assert.deepEqual(result.failures, [])
  assert.equal(result.sawCreateRoot, true)
})
