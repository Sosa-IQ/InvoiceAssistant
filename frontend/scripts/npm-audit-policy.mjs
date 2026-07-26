#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 }
const cliArgs = process.argv.slice(2)
const unknownArgs = cliArgs.filter((arg) => arg !== "--production")
if (unknownArgs.length > 0 || cliArgs.length > 1) {
  throw new Error(`unsupported arguments: ${cliArgs.join(" ") || "(none)"}`)
}
const scope = cliArgs.includes("--production") ? "production" : "full"
const threshold = scope === "production" ? "moderate" : "high"
const root = path.resolve(import.meta.dirname, "..")
const policy = JSON.parse(fs.readFileSync(path.join(root, "security/npm-audit-exceptions.json"), "utf8"))
const applicable = policy.exceptions.filter((entry) => entry.scopes.includes(scope))
const today = new Date().toISOString().slice(0, 10)
for (const entry of applicable) {
  if (entry.expires < today) throw new Error(`expired audit exception: ${entry.id}`)
}

const auditArgs = ["audit", "--json"]
if (scope === "production") auditArgs.push("--omit=dev")
const result = spawnSync("npm", auditArgs, { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 })
if (![0, 1].includes(result.status)) throw new Error(`npm audit failed operationally with exit ${result.status}`)
let report
try { report = JSON.parse(result.stdout) } catch { throw new Error("npm audit returned invalid JSON") }
if (report.auditReportVersion !== 2 || !report.vulnerabilities || !report.metadata) {
  throw new Error("unsupported or incomplete npm audit schema")
}

const vulnerabilities = report.vulnerabilities
const used = new Set()
function leavesFor(name, visiting = new Set()) {
  if (visiting.has(name)) throw new Error(`cycle in npm audit graph at ${name}`)
  const vulnerability = vulnerabilities[name]
  if (!vulnerability || !Array.isArray(vulnerability.via)) throw new Error(`missing audit graph node: ${name}`)
  const next = new Set(visiting).add(name)
  const leaves = []
  for (const via of vulnerability.via) {
    if (typeof via === "string") leaves.push(...leavesFor(via, next))
    else if (via && typeof via === "object") leaves.push(via)
    else throw new Error(`invalid audit graph edge at ${name}`)
  }
  return leaves
}

const blocked = []
for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
  if (severityRank[vulnerability.severity] < severityRank[threshold]) continue
  const leaves = leavesFor(name)
  const match = applicable.find((entry) =>
    entry.packages.includes(name)
    && leaves.length > 0
    && leaves.every((leaf) =>
      leaf.url === entry.url
      && leaf.name === entry.rootPackage
      && leaf.dependency === entry.rootPackage
      && leaf.severity === entry.severity
    )
  )
  if (!match) blocked.push(`${name}:${vulnerability.severity}`)
  else used.add(match.id)
}
for (const entry of applicable) {
  if (!used.has(entry.id)) blocked.push(`stale-exception:${entry.id}`)
}
if (blocked.length) {
  console.error(`npm audit policy failed (${scope}): ${blocked.join(", ")}`)
  process.exit(1)
}
console.log(`npm audit policy passed (${scope}); exact exceptions: ${[...used].join(", ")}`)
