import { prisma } from '../src/lib/prisma.js'

/**
 * Removes every row the test suite created, once, after all of it has finished.
 *
 * Why this is not done per test file. The audit trail is append only, enforced by a trigger on
 * `audit_log`, and `audit.test.ts` asserts that the trigger is active. Emptying the table means
 * switching the trigger off, and `ALTER TABLE ... DISABLE TRIGGER` changes the table for every
 * connection, not just the one that issued it. Vitest runs test files in parallel against one
 * database, so a per-file teardown gave two bad outcomes and no third option: switch the trigger
 * off outside a transaction and another file's append-only assertion passes through the open
 * window, or switch it off inside one and the access-exclusive lock it holds blocks every other
 * worker's audit write until the transaction commits, which turned into five-second test timeouts
 * and sixty-second hook timeouts elsewhere in the run.
 *
 * Running once, after the last file, removes the concurrency instead of trying to survive it.
 * Individual files still delete their own members, staff and sessions as they finish; what is left
 * to here is everything whose removal touches the trail or is blocked by it.
 *
 * Safe by construction. It matches only addresses ending in `@example.test`, which nothing real
 * uses, and cooperatives that are left with no staff at all and are not the demonstration
 * cooperative.
 */

const TEST_EMAIL_SUFFIX = '@example.test'

export interface PurgeReport {
  users: number
  cooperatives: number
  auditRows: number
}

export async function purgeTestData(): Promise<PurgeReport> {
  const testUsers = await prisma.user.findMany({
    where: { email: { endsWith: TEST_EMAIL_SUFFIX } },
    select: { id: true },
  })
  const userIds = testUsers.map((row) => row.id)

  // Staff rows go first, so that a cooperative a test created through the platform API — which
  // comes with its own manager — is left staffless and therefore recognised as a leftover below.
  if (userIds.length > 0) {
    await prisma.staffPermissionOverride.deleteMany({
      where: { staff: { userId: { in: userIds } } },
    })
    await prisma.cooperativeStaff.updateMany({
      where: { invitedById: { in: userIds } },
      data: { invitedById: null },
    })
    await prisma.cooperativeStaff.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } })

    // Settings record who last changed them, with RESTRICT on that reference, because in
    // production a user is suspended and never deleted. The setting is not the user's and
    // survives without them.
    await prisma.systemSetting.updateMany({
      where: { updatedById: { in: userIds } },
      data: { updatedById: null },
    })
    await prisma.cooperativeSetting.updateMany({
      where: { updatedById: { in: userIds } },
      data: { updatedById: null },
    })
  }

  const strays = await prisma.cooperative.findMany({
    where: { isDemo: false, staff: { none: {} } },
    select: { id: true },
  })
  const cooperativeIds = strays.map((row) => row.id)

  if (cooperativeIds.length > 0) {
    // The store first, because a movement points at a product, a store, a unit, a member and
    // sometimes a finance entry, and every one of those references is RESTRICT. The self
    // references — a reversal and the two halves of a transfer — are cleared before the rows go,
    // since RESTRICT is checked immediately and does not care that the referencing row is being
    // deleted in the same statement.
    await prisma.inventoryTransaction.updateMany({
      where: { cooperativeId: { in: cooperativeIds } },
      data: { reversalOfId: null, counterpartyTransactionId: null },
    })
    await prisma.inventoryTransaction.deleteMany({
      where: { cooperativeId: { in: cooperativeIds } },
    })
    await prisma.stockLevel.deleteMany({ where: { cooperativeId: { in: cooperativeIds } } })
    await prisma.product.deleteMany({ where: { cooperativeId: { in: cooperativeIds } } })
    await prisma.productCategory.deleteMany({ where: { cooperativeId: { in: cooperativeIds } } })
    await prisma.warehouse.deleteMany({ where: { cooperativeId: { in: cooperativeIds } } })
    await prisma.notification.deleteMany({ where: { cooperativeId: { in: cooperativeIds } } })

    // Members and money, child before parent. Every reference in these tables is RESTRICT,
    // because in production none of these rows is ever deleted: a member who leaves is marked as
    // having left, and a wrong figure is reversed rather than edited.
    await prisma.financeTransaction.updateMany({
      where: { cooperativeId: { in: cooperativeIds } },
      data: { reversalOfId: null },
    })
    await prisma.memberShare.deleteMany({ where: { cooperativeId: { in: cooperativeIds } } })
    await prisma.contribution.deleteMany({ where: { cooperativeId: { in: cooperativeIds } } })
    await prisma.financeTransaction.deleteMany({ where: { cooperativeId: { in: cooperativeIds } } })
    await prisma.member.deleteMany({ where: { cooperativeId: { in: cooperativeIds } } })
    await prisma.financeCategory.deleteMany({ where: { cooperativeId: { in: cooperativeIds } } })
    await prisma.idempotencyKey.deleteMany({ where: { cooperativeId: { in: cooperativeIds } } })
    await prisma.cooperativeSetting.deleteMany({ where: { cooperativeId: { in: cooperativeIds } } })
    await prisma.unitOfMeasure.deleteMany({ where: { cooperativeId: { in: cooperativeIds } } })
  }

  // Anything a test user created inside a cooperative that is staying, which the pass above
  // would not have reached. Rare, and RESTRICT would otherwise stop the user being removed.
  if (userIds.length > 0) {
    const orphans = await prisma.member.findMany({
      where: { OR: [{ createdById: { in: userIds } }, { updatedById: { in: userIds } }] },
      select: { id: true },
    })
    const memberIds = orphans.map((row) => row.id)
    if (memberIds.length > 0) {
      await prisma.inventoryTransaction.updateMany({
        where: { sourceMemberId: { in: memberIds } },
        data: { sourceMemberId: null },
      })
      await prisma.financeTransaction.updateMany({
        where: { memberId: { in: memberIds } },
        data: { reversalOfId: null },
      })
      await prisma.memberShare.deleteMany({ where: { memberId: { in: memberIds } } })
      await prisma.contribution.deleteMany({ where: { memberId: { in: memberIds } } })
      await prisma.financeTransaction.deleteMany({ where: { memberId: { in: memberIds } } })
      await prisma.member.deleteMany({ where: { id: { in: memberIds } } })
    }
    await prisma.inventoryTransaction.updateMany({
      where: { createdById: { in: userIds } },
      data: { reversalOfId: null, counterpartyTransactionId: null },
    })
    await prisma.inventoryTransaction.deleteMany({ where: { createdById: { in: userIds } } })
    await prisma.product.deleteMany({ where: { createdById: { in: userIds } } })

    await prisma.financeTransaction.updateMany({
      where: { createdById: { in: userIds } },
      data: { reversalOfId: null },
    })
    await prisma.financeTransaction.deleteMany({ where: { createdById: { in: userIds } } })
  }

  // The trail last, with the trigger briefly off. Nothing else is running at this point, so the
  // table-wide lock the ALTER takes blocks nobody.
  let auditRows = 0
  await prisma.$executeRawUnsafe('ALTER TABLE audit_log DISABLE TRIGGER USER')
  try {
    if (cooperativeIds.length > 0) {
      const removed = await prisma.auditLog.deleteMany({
        where: { cooperativeId: { in: cooperativeIds } },
      })
      auditRows += removed.count
    }
    if (userIds.length > 0) {
      const byActor = await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } })
      const byEntity = await prisma.auditLog.deleteMany({ where: { entityId: { in: userIds } } })
      auditRows += byActor.count + byEntity.count
    }
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE audit_log ENABLE TRIGGER USER')
  }

  if (cooperativeIds.length > 0) {
    await prisma.cooperative.deleteMany({ where: { id: { in: cooperativeIds } } })
  }
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  }

  return { users: userIds.length, cooperatives: cooperativeIds.length, auditRows }
}
