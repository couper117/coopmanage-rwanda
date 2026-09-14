import { randomUUID } from 'node:crypto'
import request from 'supertest'
import type { Server } from 'node:http'
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

/**
 * What supertest is pointed at. A file hands over the long-lived listener from `server.ts`
 * rather than the bare Express app, so no new port is bound per request.
 */
export type TestTarget = Server | Express

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

export async function login(app: TestTarget, user: TestUser): Promise<Session> {
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
  app: TestTarget,
  cooperative: TestCooperative,
  roleKey: RoleKey,
): Promise<TestUser & Session & { staffId: string }> {
  const user = await createUser()
  const { staffId } = await addStaff(cooperative.id, user.id, roleKey)
  const session = await login(app, user)
  return { ...user, ...session, staffId }
}

/**
 * Removes what this file created, in dependency order, as the file finishes.
 *
 * Deliberately stops short of the audit trail, the cooperatives and the accounts. Removing an
 * audit row means switching off the append-only trigger, which is a change to the table for every
 * connection, and vitest runs test files in parallel; a cooperative cannot go while its trail
 * remains, and neither can a user. All three are handled once after the whole run, by
 * `purge.ts`, where nothing is executing alongside it.
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

  // The store first. A movement points at a product, a store and sometimes a member, and every
  // one of those references is RESTRICT, so nothing below can go while a movement names it.
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
  await prisma.unitOfMeasure.deleteMany({ where: { cooperativeId: { in: cooperativeIds } } })

  // Members and money, in dependency order. Every reference in the M4 tables is RESTRICT, because
  // in production none of these rows is ever deleted: a member who leaves is marked as having
  // left, and a wrong figure is reversed. A test database still has to be emptiable, so the
  // reversal link is cleared first and the rows are then removed child before parent.
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

  createdCooperativeIds.clear()
  createdUserIds.clear()
  clearPermissionCache()
}
