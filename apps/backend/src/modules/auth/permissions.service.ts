import {
  isPermissionKey,
  isRoleKey,
  resolvePermissions,
  type PermissionKey,
  type RoleKey,
} from '@coopmanage/shared'
import { prisma } from '../../lib/prisma.js'

/**
 * Effective permissions for one staff row: the role's set, plus GRANT overrides, minus DENY
 * overrides. The arithmetic itself lives in the shared package, so the interface computes the same
 * answer from the same rule.
 *
 * The result is cached for 60 seconds because it is read on every single request and changes
 * rarely. Anything that edits a role or an override calls `invalidateStaffPermissions`, so the
 * cache is a latency optimisation and never the reason someone keeps access they have lost.
 */
const CACHE_TTL_MS = 60_000

interface CacheEntry {
  roleKey: RoleKey
  permissions: ReadonlySet<PermissionKey>
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

export interface StaffPermissions {
  roleKey: RoleKey
  permissions: ReadonlySet<PermissionKey>
}

export async function staffPermissions(staffId: string): Promise<StaffPermissions> {
  const cached = cache.get(staffId)
  if (cached && cached.expiresAt > Date.now()) {
    return { roleKey: cached.roleKey, permissions: cached.permissions }
  }

  const staff = await prisma.cooperativeStaff.findUnique({
    where: { id: staffId },
    select: {
      role: { select: { key: true } },
      overrides: { select: { effect: true, permission: { select: { key: true } } } },
    },
  })
  if (!staff) throw new Error(`Staff row ${staffId} disappeared while resolving permissions`)

  const roleKey = staff.role.key
  if (!isRoleKey(roleKey)) {
    // The role table is seeded from the shared catalogue, so this means the two have diverged.
    // Failing loudly is the only safe answer: silently granting nothing would look like a bug in
    // the interface, and guessing would grant permissions nobody chose.
    throw new Error(`Staff row ${staffId} holds unknown role "${roleKey}"`)
  }

  const overrides = staff.overrides
    .filter((override) => isPermissionKey(override.permission.key))
    .map((override) => ({
      permission: override.permission.key as PermissionKey,
      effect: override.effect,
    }))

  const permissions: ReadonlySet<PermissionKey> = resolvePermissions(roleKey, overrides)
  cache.set(staffId, { roleKey, permissions, expiresAt: Date.now() + CACHE_TTL_MS })
  return { roleKey, permissions }
}

/** Called by every path that changes a role or an override, so the change is visible at once. */
export function invalidateStaffPermissions(staffId: string): void {
  cache.delete(staffId)
}

/** Used by the tests, and after a seed, when many staff rows change at once. */
export function clearPermissionCache(): void {
  cache.clear()
}
