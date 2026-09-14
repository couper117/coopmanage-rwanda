import { disconnectPrisma } from '../src/lib/prisma.js'
import { purgeTestData } from './purge.js'

/**
 * Vitest's global hooks, which run once in the main process rather than per test file.
 *
 * Nothing is needed before the run. The teardown is where the suite's destructive cleanup lives,
 * for the reasons set out in `purge.ts`: it has to happen when no test file is executing.
 */
export function setup(): void {}

export async function teardown(): Promise<void> {
  try {
    const report = await purgeTestData()
    if (report.users > 0 || report.cooperatives > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `\ncleaned up ${report.users} test accounts, ${report.cooperatives} cooperatives and ${report.auditRows} audit rows`,
      )
    }
  } finally {
    await disconnectPrisma()
  }
}
