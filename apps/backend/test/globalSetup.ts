import { rm } from 'node:fs/promises'
import { disconnectPrisma } from '../src/lib/prisma.js'
import { purgeTestData } from './purge.js'
import { clearRecordings, routeCoverage } from './routeCoverage.js'
// Importing the router populates the registry the coverage check compares against.
import '../src/routes.js'

/**
 * Vitest's global hooks, which run once in the main process rather than per test file.
 *
 * Nothing is needed before the run. The teardown is where the suite's destructive cleanup lives,
 * for the reasons set out in `purge.ts`: it has to happen when no test file is executing.
 */
export function setup(): void {
  clearRecordings()
}

export async function teardown(): Promise<void> {
  try {
    assertEveryRouteExercised()
    const report = await purgeTestData()
    // The files the upload tests wrote. The directory is the one `vitest.config.ts` points the
    // storage driver at for the duration of a run, so removing it cannot touch a developer's own
    // store — and it is removed here rather than per file because several test files write into it.
    await rm('./storage-test', { recursive: true, force: true })
    if (report.users > 0 || report.cooperatives > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `\ncleaned up ${report.users} test accounts, ${report.cooperatives} cooperatives and ${report.auditRows} audit rows`,
      )
    }
  } finally {
    clearRecordings()
    await disconnectPrisma()
  }
}

/**
 * The Phase 17 gate: an endpoint nobody has a passing test for fails the run, by name. Skipped
 * when the run was filtered to a subset of files — `vitest run test/members.test.ts` cannot be
 * expected to have exercised the sales routes — which Vitest signals through its own argument
 * list rather than through anything this hook is given.
 */
function assertEveryRouteExercised(): void {
  const filtered = process.argv
    .slice(2)
    .some((arg) => !arg.startsWith('-') && !['run', 'watch', 'dev'].includes(arg))
  if (filtered) return
  const { exercised, unexercised } = routeCoverage()
  if (exercised.length === 0) return // Nothing was recorded at all: the run did not get that far.
  if (unexercised.length > 0) {
    throw new Error(
      `${unexercised.length} of ${exercised.length + unexercised.length} routes have no test that reaches a successful response:\n  ${unexercised.join('\n  ')}`,
    )
  }
  // eslint-disable-next-line no-console
  console.log(`\nevery one of the ${exercised.length} routes was exercised by a passing test`)
}
