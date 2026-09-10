/**
 * The permission catalogue. This module is the single source of truth: the database `Permission`
 * table is seeded from it, the backend checks against it, and the frontend hides controls with it.
 * `docs/permissions.md` documents it and the test suite asserts the two agree.
 */

export const COOPERATIVE_PERMISSIONS = [
  'dashboard:view',
  'search:use',
  'assistant:use',
  'notifications:view',
  'cooperative:view',
  'cooperative:update',
  'settings:manage',
  'staff:view',
  'staff:invite',
  'staff:manage',
  'audit:view',
  'members:view',
  'members:create',
  'members:update',
  'members:deactivate',
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
  'sales:create',
  'sales:confirm',
  'sales:cancel',
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
] as const

export const PLATFORM_PERMISSIONS = [
  'platform:cooperatives:view',
  'platform:cooperatives:manage',
  'platform:users:view',
  'platform:users:manage',
  'platform:settings:manage',
  'platform:health:view',
  'platform:audit:view',
] as const

export const ALL_PERMISSIONS = [...COOPERATIVE_PERMISSIONS, ...PLATFORM_PERMISSIONS] as const

export type CooperativePermission = (typeof COOPERATIVE_PERMISSIONS)[number]
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number]
export type PermissionKey = CooperativePermission | PlatformPermission

export type PermissionScope = 'COOPERATIVE' | 'PLATFORM'

export function permissionScope(key: PermissionKey): PermissionScope {
  return key.startsWith('platform:') ? 'PLATFORM' : 'COOPERATIVE'
}

/** `finance:categories:manage` splits into resource `finance:categories` and action `manage`. */
export function splitPermission(key: PermissionKey): { resource: string; action: string } {
  const index = key.lastIndexOf(':')
  return { resource: key.slice(0, index), action: key.slice(index + 1) }
}

export function isPermissionKey(value: string): value is PermissionKey {
  return (ALL_PERMISSIONS as readonly string[]).includes(value)
}
