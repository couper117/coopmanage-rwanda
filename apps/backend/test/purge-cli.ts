import { disconnectPrisma } from '../src/lib/prisma.js'
import { purgeTestData } from './purge.js'

/**
 * `npm run db:purge-test-data`.
 *
 * The suite cleans up after itself, but a run that is interrupted leaves rows behind, and those
 * accumulate until a list screen in development is mostly test data. Same implementation the
 * suite's own teardown uses, so there is one definition of what counts as test data.
 */
try {
  const report = await purgeTestData()
  // This is a command whose whole output is this line.
  // eslint-disable-next-line no-console
  console.log(
    `removed ${report.users} test accounts, ${report.cooperatives} cooperatives and ${report.auditRows} audit rows`,
  )
} finally {
  await disconnectPrisma()
}
