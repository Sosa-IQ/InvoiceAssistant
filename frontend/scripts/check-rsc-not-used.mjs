#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import ts from "typescript"

const FORBIDDEN_MODULE = /^(?:react-router(?:\/|$)|@react-router(?:\/|$)|react-server(?:\/|$)|react-server-dom-)/

function staticText(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : null
}

export function scanSource(relative, source) {
  const failures = []
  if (/entry\.rsc\.|rsc.*server|server.*rsc/i.test(relative)) failures.push(`prohibited RSC entry: ${relative}`)
  const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true)
  let sawCreateRoot = false

  function rejectModule(specifier) {
    if (FORBIDDEN_MODULE.test(specifier)) failures.push(`prohibited server/router module in ${relative}: ${specifier}`)
  }

  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const moduleName = staticText(node.moduleSpecifier)
      if (moduleName !== null) rejectModule(moduleName)
    }
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require"
      if ((isDynamicImport || isRequire) && node.arguments.length >= 1) {
        const moduleName = staticText(node.arguments[0])
        if (moduleName !== null) rejectModule(moduleName)
      }
    }
    if (ts.isIdentifier(node)) {
      if (node.text === "createRoot") sawCreateRoot = true
      if (node.text.startsWith("unstable_")) failures.push(`prohibited unstable API in ${relative}: ${node.text}`)
    }
    const literal = staticText(node)
    if (literal !== null && literal.startsWith("unstable_")) {
      failures.push(`prohibited computed unstable API in ${relative}: ${literal}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return { failures: [...new Set(failures)], sawCreateRoot }
}

export function checkWorkspace(root) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
  const components = JSON.parse(fs.readFileSync(path.join(root, "components.json"), "utf8"))
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies }
  const failures = []

  for (const name of Object.keys(dependencies)) {
    if (name === "react-router" || name.startsWith("@react-router/") || name.startsWith("react-server-dom-")) {
      failures.push(`prohibited direct dependency: ${name}`)
    }
  }
  if (components.rsc !== false) failures.push("components.json must keep rsc=false")
  if (!packageJson.scripts?.build?.includes("vite")) failures.push("build must remain a Vite SPA")

  const tracked = spawnSync("git", ["ls-files", "src", "components.json", "package.json"], { cwd: root, encoding: "utf8" })
  if (tracked.status !== 0) throw new Error("git ls-files failed")
  let sawCreateRoot = false
  for (const relative of tracked.stdout.trim().split("\n").filter(Boolean)) {
    if (!/\.[cm]?[jt]sx?$/.test(relative)) continue
    const result = scanSource(relative, fs.readFileSync(path.join(root, relative), "utf8"))
    failures.push(...result.failures)
    sawCreateRoot ||= result.sawCreateRoot
  }
  if (!sawCreateRoot) failures.push("browser createRoot invariant not found")
  return [...new Set(failures)]
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ""
if (import.meta.url === invokedPath) {
  const failures = checkWorkspace(path.resolve(import.meta.dirname, ".."))
  if (failures.length) {
    console.error(`RSC guard failed:\n- ${failures.join("\n- ")}`)
    process.exit(1)
  }
  console.log("RSC guard passed: tracked frontend source is a client-only Vite SPA.")
}
