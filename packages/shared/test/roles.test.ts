import { describe, expect, it } from 'vitest'
import { COOPERATIVE_PERMISSIONS, PLATFORM_PERMISSIONS } from '../src/permissions.js'
import {
  isRoleKey,
  resolvePermissions,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  ROLE_SCOPE,
} from '../src/roles.js'

/**
 * These expectations are transcribed from the role matrix in docs/permissions.md section 3. If the
 * matrix and the code diverge, this test is the thing that catches it.
 */
const EXPECTED_SIZES: Record<string, number> = {
  MANAGER: 51,
  ACCOUNTANT: 29,
  SECRETARY: 23,
  INVENTORY_OFFICER: 23,
  VIEWER: 17,
  SYSTEM_ADMIN: 11,
}

describe('role matrix', () => {
  it('defines every role exactly once', () => {
    expect(new Set(ROLE_KEYS).size).toBe(ROLE_KEYS.length)
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLE_KEYS].sort())
  })

  it('grants the documented number of permissions per role', () => {
    for (const role of ROLE_KEYS) {
      expect(new Set(ROLE_PERMISSIONS[role]).size, `${role} size`).toBe(EXPECTED_SIZES[role])
    }
  })

  it('never grants a permission outside the catalogue', () => {
    const catalogue = new Set<string>([...COOPERATIVE_PERMISSIONS, ...PLATFORM_PERMISSIONS])
    for (const role of ROLE_KEYS) {
      for (const key of ROLE_PERMISSIONS[role]) expect(catalogue.has(key), key).toBe(true)
    }
  })

  it('gives the manager every cooperative permission and no platform permission', () => {
    const manager = new Set<string>(ROLE_PERMISSIONS.MANAGER)
    for (const key of COOPERATIVE_PERMISSIONS) expect(manager.has(key), key).toBe(true)
    for (const key of PLATFORM_PERMISSIONS) expect(manager.has(key), key).toBe(false)
  })

  it('keeps the viewer read-only', () => {
    const writeActions = ['create', 'update', 'manage', 'deactivate', 'void', 'confirm', 'cancel']
    for (const key of ROLE_PERMISSIONS.VIEWER) {
      const action = key.slice(key.lastIndexOf(':') + 1)
      expect(writeActions, `viewer holds ${key}`).not.toContain(action)
    }
    expect(ROLE_PERMISSIONS.VIEWER).not.toContain('reports:export')
  })

  it('denies the system administrator any write access inside a cooperative', () => {
    const forbidden = [
      'finance:create',
      'finance:void',
      'inventory:receive',
      'inventory:issue',
      'sales:create',
      'sales:confirm',
      'members:create',
      'documents:view',
      'settings:manage',
    ]
    for (const key of forbidden) expect(ROLE_PERMISSIONS.SYSTEM_ADMIN).not.toContain(key)
    for (const key of PLATFORM_PERMISSIONS) expect(ROLE_PERMISSIONS.SYSTEM_ADMIN).toContain(key)
  })

  it('separates the accountant from the secretary as documented', () => {
    expect(ROLE_PERMISSIONS.SECRETARY).not.toContain('finance:view')
    expect(ROLE_PERMISSIONS.SECRETARY).toContain('contributions:view')
    expect(ROLE_PERMISSIONS.SECRETARY).not.toContain('contributions:create')
    expect(ROLE_PERMISSIONS.ACCOUNTANT).not.toContain('members:create')
    expect(ROLE_PERMISSIONS.ACCOUNTANT).toContain('sales:confirm')
    expect(ROLE_PERMISSIONS.ACCOUNTANT).not.toContain('sales:cancel')
  })

  it('gives the inventory officer members:view so deliveries can be attributed', () => {
    expect(ROLE_PERMISSIONS.INVENTORY_OFFICER).toContain('members:view')
    expect(ROLE_PERMISSIONS.INVENTORY_OFFICER).toContain('units:manage')
    expect(ROLE_PERMISSIONS.INVENTORY_OFFICER).not.toContain('settings:manage')
  })

  it('scopes the system administrator to the platform', () => {
    expect(ROLE_SCOPE.SYSTEM_ADMIN).toBe('PLATFORM')
    expect(ROLE_SCOPE.MANAGER).toBe('COOPERATIVE')
  })
})

describe('resolvePermissions', () => {
  it('returns the role set when there are no overrides', () => {
    expect(resolvePermissions('VIEWER').size).toBe(EXPECTED_SIZES.VIEWER)
  })

  it('adds a granted permission the role lacks', () => {
    const set = resolvePermissions('VIEWER', [{ permission: 'members:create', effect: 'GRANT' }])
    expect(set.has('members:create')).toBe(true)
  })

  it('removes a denied permission the role grants', () => {
    const set = resolvePermissions('ACCOUNTANT', [{ permission: 'finance:void', effect: 'DENY' }])
    expect(set.has('finance:void')).toBe(false)
    expect(set.has('finance:create')).toBe(true)
  })

  it('lets a denial win over a grant for the same key', () => {
    const set = resolvePermissions('VIEWER', [
      { permission: 'finance:create', effect: 'GRANT' },
      { permission: 'finance:create', effect: 'DENY' },
    ])
    expect(set.has('finance:create')).toBe(false)
  })
})

describe('isRoleKey', () => {
  it('recognises every role and nothing else', () => {
    for (const key of ROLE_KEYS) expect(isRoleKey(key)).toBe(true)
    expect(isRoleKey('manager')).toBe(false)
    expect(isRoleKey('OWNER')).toBe(false)
  })
})
