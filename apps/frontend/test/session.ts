import {
  ROLE_PERMISSIONS,
  type Membership,
  type PermissionKey,
  type RoleKey,
} from '@coopmanage/shared'
import { useAuthStore } from '../src/stores/authStore'

/**
 * Puts a signed-in session into the store so a test can render a guarded screen.
 *
 * It sets the same shape `/auth/me` produces rather than stubbing the guard, so the guard, the
 * permission-filtered navigation and the screens all run for real. What is faked is the network
 * call, and nothing else.
 */
export const TEST_COOPERATIVE_ID = '3f2a1c88-0b1e-4d2a-9f77-2c5d4e6a7b81'

export function signInAs(
  roleKey: RoleKey = 'MANAGER',
  options: { permissions?: PermissionKey[]; isDemo?: boolean; mustChangePassword?: boolean } = {},
): void {
  const membership: Membership = {
    cooperativeId: TEST_COOPERATIVE_ID,
    cooperativeName: 'Abahuzamugambi Coffee',
    cooperativeCode: 'ABAHUZA-HUYE',
    isDemo: options.isDemo ?? false,
    roleKey,
    roleNameEn: 'Manager',
    roleNameRw: 'Umuyobozi',
    jobTitle: null,
  }

  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'test-access-token',
    user: {
      id: '9c1f0d2e-6a4b-4f31-8c7d-1e2b3a4c5d6f',
      email: 'uwimana.claudine@example.test',
      fullName: 'Claudine Uwimana',
      phone: null,
      locale: 'EN',
      isPlatformAdmin: false,
      mustChangePassword: options.mustChangePassword ?? false,
      lastLoginAt: '2026-09-10T07:15:00.000Z',
    },
    memberships: [membership],
    activeCooperativeId: TEST_COOPERATIVE_ID,
    roleKey,
    permissions: new Set(options.permissions ?? ROLE_PERMISSIONS[roleKey]),
  })
}

export function signOutForTests(): void {
  useAuthStore.setState({
    status: 'anonymous',
    accessToken: null,
    user: null,
    memberships: [],
    activeCooperativeId: null,
    roleKey: null,
    permissions: new Set(),
  })
}

/** The state a cold load starts in, before the refresh cookie has been exchanged. */
export function resetSession(): void {
  useAuthStore.setState({
    status: 'unknown',
    accessToken: null,
    user: null,
    memberships: [],
    activeCooperativeId: null,
    roleKey: null,
    permissions: new Set(),
  })
}
