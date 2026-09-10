import { describe, expect, it } from 'vitest'
import {
  ALL_PERMISSIONS,
  COOPERATIVE_PERMISSIONS,
  isPermissionKey,
  permissionScope,
  PLATFORM_PERMISSIONS,
  splitPermission,
} from '../src/permissions.js'

describe('permission catalogue', () => {
  it('has no duplicate keys', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length)
  })

  it('matches the counts documented in docs/permissions.md', () => {
    expect(COOPERATIVE_PERMISSIONS).toHaveLength(51)
    expect(PLATFORM_PERMISSIONS).toHaveLength(7)
  })

  it('scopes every key by its prefix', () => {
    for (const key of COOPERATIVE_PERMISSIONS) expect(permissionScope(key)).toBe('COOPERATIVE')
    for (const key of PLATFORM_PERMISSIONS) expect(permissionScope(key)).toBe('PLATFORM')
  })

  it('uses only lower-case resource:action keys', () => {
    for (const key of ALL_PERMISSIONS) expect(key).toMatch(/^[a-z]+(:[a-z]+)+$/)
  })

  it('splits a multi-segment resource at the last colon', () => {
    expect(splitPermission('finance:categories:manage')).toEqual({
      resource: 'finance:categories',
      action: 'manage',
    })
    expect(splitPermission('members:view')).toEqual({ resource: 'members', action: 'view' })
  })

  it('recognises only real keys', () => {
    expect(isPermissionKey('members:view')).toBe(true)
    expect(isPermissionKey('members:destroy')).toBe(false)
  })
})
