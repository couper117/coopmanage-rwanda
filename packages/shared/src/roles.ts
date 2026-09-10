import {
  COOPERATIVE_PERMISSIONS,
  type CooperativePermission,
  type PermissionKey,
  PLATFORM_PERMISSIONS,
} from './permissions.js'

export const ROLE_KEYS = [
  'MANAGER',
  'ACCOUNTANT',
  'SECRETARY',
  'INVENTORY_OFFICER',
  'VIEWER',
  'SYSTEM_ADMIN',
] as const

export type RoleKey = (typeof ROLE_KEYS)[number]

/** Permissions every cooperative role holds. */
const BASELINE: readonly CooperativePermission[] = [
  'dashboard:view',
  'search:use',
  'assistant:use',
  'notifications:view',
  'cooperative:view',
]

const ACCOUNTANT: readonly CooperativePermission[] = [
  ...BASELINE,
  'members:view',
  'members:export',
  'shares:view',
  'shares:manage',
  'contributions:view',
  'contributions:create',
  'contributions:void',
  'finance:view',
  'finance:create',
  'finance:void',
  'finance:export',
  'finance:categories:manage',
  'products:view',
  'inventory:view',
  'buyers:view',
  'sales:view',
  'sales:create',
  'sales:confirm',
  'reports:view',
  'reports:export',
  'documents:view',
  'documents:upload',
  'meetings:view',
  'announcements:view',
]

const SECRETARY: readonly CooperativePermission[] = [
  ...BASELINE,
  'staff:view',
  'members:view',
  'members:create',
  'members:update',
  'members:deactivate',
  'members:export',
  'shares:view',
  'contributions:view',
  'reports:view',
  'reports:export',
  'documents:view',
  'documents:upload',
  'documents:archive',
  'meetings:view',
  'meetings:manage',
  'announcements:view',
  'announcements:manage',
  'sms:send',
]

const INVENTORY_OFFICER: readonly CooperativePermission[] = [
  ...BASELINE,
  'members:view',
  'products:view',
  'products:manage',
  'units:manage',
  'warehouses:manage',
  'inventory:view',
  'inventory:receive',
  'inventory:issue',
  'inventory:adjust',
  'inventory:transfer',
  'buyers:view',
  'buyers:manage',
  'sales:view',
  'reports:view',
  'reports:export',
  'documents:view',
  'meetings:view',
  'announcements:view',
]

const VIEWER: readonly CooperativePermission[] = [
  ...BASELINE,
  'members:view',
  'shares:view',
  'contributions:view',
  'finance:view',
  'products:view',
  'inventory:view',
  'buyers:view',
  'sales:view',
  'reports:view',
  'documents:view',
  'meetings:view',
  'announcements:view',
]

/**
 * The system administrator is a platform role. Inside a cooperative it may read the profile, the
 * staff list, the audit log and reports, and nothing else. It cannot post transactions, move stock
 * or read private documents, so a platform operator can never quietly alter a cooperative's records.
 */
const SYSTEM_ADMIN: readonly PermissionKey[] = [
  ...PLATFORM_PERMISSIONS,
  'cooperative:view',
  'staff:view',
  'audit:view',
  'reports:view',
]

export const ROLE_PERMISSIONS: Readonly<Record<RoleKey, readonly PermissionKey[]>> = {
  MANAGER: COOPERATIVE_PERMISSIONS,
  ACCOUNTANT,
  SECRETARY,
  INVENTORY_OFFICER,
  VIEWER,
  SYSTEM_ADMIN,
}

export const ROLE_SCOPE: Readonly<Record<RoleKey, 'COOPERATIVE' | 'PLATFORM'>> = {
  MANAGER: 'COOPERATIVE',
  ACCOUNTANT: 'COOPERATIVE',
  SECRETARY: 'COOPERATIVE',
  INVENTORY_OFFICER: 'COOPERATIVE',
  VIEWER: 'COOPERATIVE',
  SYSTEM_ADMIN: 'PLATFORM',
}

export function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value)
}

/**
 * Effective permissions for a staff member: the role's set, plus explicit grants, minus explicit
 * denials. Denials always win, which is what makes an override safe to hand to a manager.
 */
export function resolvePermissions(
  roleKey: RoleKey,
  overrides: readonly { permission: PermissionKey; effect: 'GRANT' | 'DENY' }[] = [],
): Set<PermissionKey> {
  const effective = new Set<PermissionKey>(ROLE_PERMISSIONS[roleKey])
  for (const override of overrides) {
    if (override.effect === 'GRANT') effective.add(override.permission)
  }
  for (const override of overrides) {
    if (override.effect === 'DENY') effective.delete(override.permission)
  }
  return effective
}
