import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { observeRoutes, registeredRoutes } from '../src/lib/routeRegistry.js'

/**
 * Proof that every endpoint has a test.
 *
 * Each worker records every response a registered route sends, as `METHOD /path/:param STATUS`,
 * into a file of its own; the global teardown reads them all and compares against the registry.
 * A route counts as exercised only when some test received a **successful** response from it. A
 * 401 from the session guard or a 404 from the cross-tenant sweep proves the route is mounted,
 * not that it works, and the exit criterion for Phase 17 is an integration test for every
 * endpoint — its happy path, not its refusals.
 *
 * Kept as files rather than in memory because Vitest runs test files in separate worker processes
 * and the teardown runs in the main one.
 */
export const COVERAGE_DIR = join(process.cwd(), 'test', '.route-coverage')

export function startRecording(): void {
  mkdirSync(COVERAGE_DIR, { recursive: true })
  const file = join(COVERAGE_DIR, `${process.pid}-${Date.now()}.log`)
  observeRoutes(({ method, path, status }) => {
    appendFileSync(file, `${method} ${path} ${status}\n`)
  })
}

export function stopRecording(): void {
  observeRoutes(undefined)
}

export function clearRecordings(): void {
  rmSync(COVERAGE_DIR, { recursive: true, force: true })
}

export interface CoverageReport {
  exercised: string[]
  unexercised: string[]
}

/** Every registered route, split by whether any test saw a successful response from it. */
export function routeCoverage(): CoverageReport {
  const successful = new Set<string>()
  let files: string[] = []
  try {
    files = readdirSync(COVERAGE_DIR)
  } catch {
    files = []
  }
  for (const name of files) {
    const lines = readFileSync(join(COVERAGE_DIR, name), 'utf8').split('\n')
    for (const line of lines) {
      const match = /^(\S+) (\S+) (\d{3})$/.exec(line)
      if (!match) continue
      const status = Number(match[3])
      if (status < 400) successful.add(`${match[1]} ${match[2]}`)
    }
  }
  const all = registeredRoutes().map((route) => `${route.method} ${route.path}`)
  return {
    exercised: all.filter((route) => successful.has(route)),
    unexercised: all.filter((route) => !successful.has(route)),
  }
}
