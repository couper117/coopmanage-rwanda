import { randomUUID } from 'node:crypto'
import request from 'supertest'
import type { Express } from 'express'
import type { PermissionKey, RoleKey } from '@coopmanage/shared'
import { API_PREFIX } from '../src/app.js'
import { hashPassword } from '../src/lib/password.js'
import { prisma } from '../src/lib/prisma.js'
import { clearPermissionCache } from '../src/modules/auth/permissions.service.js'

/**
 * Test data that is built, used and removed by the suite that asks for it. Nothing here depends on
 * the seed beyond the reference tables, so the tests say what they need out loud and two suites
 * running against the same database cannot collide.
 */

/** Marks every row a test creates, so teardown can find them all without guessing. */
export const TEST_TAG = `test-${randomUUID().slice(0, 8)}`

/** The domain every test account uses. Nothing real is ever on it. */
export const TEST_EMAIL_DOMAIN = '@example.test'

/**
 * Builds an address for an account a test will create *through the API* — an invited member of
 * staff, or the first manager of a new cooperative. Those rows never pass through the helpers
 * here, so nothing tracks their ids and they were being left behind in the database.
 *
 * The suite's own `TEST_TAG` is in the address, which is what lets teardown find them. Scoping by
 * the tag rather than by the whole test domain matters: vitest runs test files in parallel against
 * one database, so a purge of everything on the domain deletes rows another file is still using.
 */
export function testEmail(prefix: string): string {
  return `${prefix}-${TEST_TAG}-${randomUUID().slice(0, 6)}${TEST_EMAIL_DOMAIN}`
}

export const TEST_PASSWORD = 'correct-horse-battery-staple'

const createdUserIds = new Set<string>()
const createdCooperativeIds = new Set<string>()

export interface TestUser {
  id: string
  email: string
  password: string
}

export async function createUser(
  options: {
    fullName?: string
    isPlatformAdmin?: boolean
    status?: 'ACTIVE' | 'SUSPENDED'
    password?: string
  } = {},
): Promise<TestUser> {
  const email = `${TEST_TAG}-${randomUUID().slice(0, 8)}@example.test`
  const password = options.password ?? TEST_PASSWORD
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      fullName: options.fullName ?? 'Uwase Divine',
      isPlatformAdmin: options.isPlatformAdmin ?? false,
      status: options.status ?? 'ACTIVE',
    },
    select: { id: true },
  })
  createdUserIds.add(user.id)
  return { id: user.id, email, password }
}

export interface TestCooperative {
  id: string
  code: string
  name: string
}

export async function createCooperative(name = 'Abahuzamugambi Coffee'): Promise<TestCooperative> {
  const type = await prisma.cooperativeType.findFirstOrThrow({ select: { id: true } })
  const code = `${TEST_TAG}-${randomUUID().slice(0, 8)}`.toUpperCase()
  const cooperative = await prisma.cooperative.create({
    data: {
      code,
      name,
      typeId: type.id,
      province: 'SOUTHERN',
      district: 'Huye',
      sector: 'Ngoma',
      cell: 'Butare',
      village: 'Rango',
    },
    select: { id: true, code: true, name: true },
  })
  createdCooperativeIds.add(cooperative.id)
  return cooperative
}

export async function addStaff(
  cooperativeId: string,
  userId: string,
  roleKey: RoleKey,
): Promise<{ staffId: string }> {
  const role = await prisma.role.findUniqueOrThrow({
    where: { key: roleKey },
    select: { id: true },
  })
  const staff = await prisma.cooperativeStaff.create({
    data: { cooperativeId, userId, roleId: role.id, joinedAt: new Date() },
    select: { id: true },
  })
  return { staffId: staff.id }
}

export async function setOverride(
  staffId: string,
  permission: PermissionKey,
  effect: 'GRANT' | 'DENY',
): Promise<void> {
  const row = await prisma.permission.findUniqueOrThrow({
    where: { key: permission },
    select: { id: true },
  })
  await prisma.staffPermissionOverride.upsert({
    where: { staffId_permissionId: { staffId, permissionId: row.id } },
    create: { staffId, permissionId: row.id, effect },
    update: { effect },
  })
  clearPermissionCache()
}

export async function clearOverrides(staffId: string): Promise<void> {
  await prisma.staffPermissionOverride.deleteMany({ where: { staffId } })
  clearPermissionCache()
}

export interface Session {
  accessToken: string
  /** The `Set-Cookie` values from login, ready to hand back to a cookie-authenticated endpoint. */
  cookies: string[]
}

export async function login(app: Express, user: TestUser): Promise<Session> {
  const response = await request(app)
    .post(`${API_PREFIX}/auth/login`)
    .send({ email: user.email, password: user.password })
    .expect(200)

  const raw = response.headers['set-cookie']
  return {
    accessToken: response.body.data.accessToken as string,
    cookies: Array.isArray(raw) ? raw : raw ? [raw] : [],
  }
}

/** A ready-to-use staff member: user, membership and a live session. */
export async function createStaffSession(
  app: Express,
  cooperative: TestCooperative,
  roleKey: RoleKey,
): Promise<TestUser & Session & { staffId: string }> {
  const user = await createUser()
  const { staffId } = await addStaff(cooperative.id, user.id, roleKey)
  const session = await login(app, user)
  return { ...user, ...session, staffId }
}

/**
 * Removes everything the run created, in dependency order.
 *
 * The audit trigger is switched off for the duration. It is the mechanism that makes the trail
 * append only in every other context, and `audit.test.ts` asserts it is active; a test database
 * that could not be cleaned would instead grow without limit and eventually make the suite
 * depend on rows from a previous run.
 */
export async function cleanupFixtures(): Promise<void> {
  const cooperativeIds = [...createdCooperativeIds]
  const userIds = [...createdUserIds]
  if (cooperativeIds.length === 0 && userIds.length === 0) return

  await prisma.staffPermissionOverride.deleteMany({
    where: { staff: { cooperativeId: { in: cooperativeIds } } },
  })
  await prisma.cooperativeStaff.deleteMany({ where: { cooperativeId: { in: cooperativeIds } } })
  await prisma.refreshSession.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } })

  await prisma.$executeRawUnsafe('ALTER TABLE audit_log DISABLE TRIGGER USER')
  try {
    await prisma.auditLog.deleteMany({
      where: { OR: [{ cooperativeId: { in: cooperativeIds } }, { actorUserId: { in: userIds } }] },
    })
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE audit_log ENABLE TRIGGER USER')
  }

  await prisma.cooperative.deleteMany({ where: { id: { in: cooperativeIds } } })

  // Settings record who last changed them, with RESTRICT on that reference, because in production
  // a user is suspended and never deleted. A test does delete them, so the authorship is cleared
  // first; the setting itself is not the user's and survives without them.
  await prisma.systemSetting.updateMany({
    where: { updatedById: { in: userIds } },
    data: { updatedById: null },
  })
  await prisma.cooperativeSetting.updateMany({
    where: { updatedById: { in: userIds } },
    data: { updatedById: null },
  })

  await prisma.user.deleteMany({ where: { id: { in: userIds } } })

  await purgeApiCreatedTestUsers()

  createdCooperativeIds.clear()
  createdUserIds.clear()
  clearPermissionCache()
}

/**
 * Removes the accounts an endpoint created during this suite: invited staff, and the first manager
 * of a cooperative created through the platform API. Matched by this suite's own tag, so it cannot
 * touch a real account, a seeded one, or another test file's rows.
 */
async function purgeApiCreatedTestUsers(): Promise<void> {
  const strays = await prisma.user.findMany({
    where: { email: { contains: TEST_TAG } },
    select: { id: true },
  })
  if (strays.length === 0) return
  const ids = strays.map((row) => row.id)

  await prisma.staffPermissionOverride.deleteMany({ where: { staff: { userId: { in: ids } } } })
  await prisma.cooperativeStaff.deleteMany({ where: { userId: { in: ids } } })
  await prisma.cooperativeStaff.updateMany({
    where: { invitedById: { in: ids } },
    data: { invitedById: null },
  })
  await prisma.refreshSession.deleteMany({ where: { userId: { in: ids } } })
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: ids } } })
  await prisma.systemSetting.updateMany({
    where: { updatedById: { in: ids } },
    data: { updatedById: null },
  })
  await prisma.cooperativeSetting.updateMany({
    where: { updatedById: { in: ids } },
    data: { updatedById: null },
  })

  await prisma.$executeRawUnsafe('ALTER TABLE audit_log DISABLE TRIGGER USER')
  try {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } })
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } })
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE audit_log ENABLE TRIGGER USER')
  }

  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}
