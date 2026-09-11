import type { Locale } from './enums.js'
import type { PermissionKey } from './permissions.js'
import type { RoleKey } from './roles.js'

/**
 * The authentication contract, shared so the interface and the API cannot disagree about the shape
 * of a session. See `docs/api.md` section 2 and `docs/security.md` section 2.
 */

export const MIN_PASSWORD_LENGTH = 10
export const MAX_PASSWORD_LENGTH = 128

/**
 * The passwords attackers try first. Deliberately short: it exists to stop the handful of choices
 * that a credential-stuffing list would break in seconds, not to impose composition rules that
 * push people towards `Password1!`. Comparison is case-insensitive and ignores surrounding space.
 */
const COMMON_PASSWORDS: readonly string[] = [
  'password',
  'password1',
  'password12',
  'password123',
  'password1234',
  'passw0rd123',
  '123456789',
  '1234567890',
  '12345678910',
  'qwertyuiop',
  'qwerty12345',
  'iloveyou123',
  'letmein123',
  'welcome123',
  'admin12345',
  'administrator',
  'coopmanage',
  'coopmanage1',
  'cooperative',
  'cooperative1',
  'rwanda12345',
  'kigali12345',
  'abc123456789',
  '111111111111',
  'aaaaaaaaaa',
  'changeme123',
  'secret12345',
  'trustno1234',
  'monkey12345',
  'football123',
  'sunshine123',
  'princess123',
  'qwertyuiop123',
  'zaq12wsxcde3',
  'asdfghjkl123',
]

export type PasswordProblem = 'tooShort' | 'tooLong' | 'tooCommon'

/**
 * The one place the password rule lives. The interface uses it to tell someone why their choice
 * was refused before they submit; the API uses it again, because no frontend check is trusted.
 */
export function checkPassword(password: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'tooShort'
  if (password.length > MAX_PASSWORD_LENGTH) return 'tooLong'
  if (COMMON_PASSWORDS.includes(password.trim().toLowerCase())) return 'tooCommon'
  return null
}

/** The signed-in person. Never carries the password hash or any token. */
export interface AuthUser {
  id: string
  email: string
  fullName: string
  phone: string | null
  locale: Locale
  isPlatformAdmin: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
}

/** One cooperative the caller may act in, as returned by login and by `GET /auth/me`. */
export interface Membership {
  cooperativeId: string
  cooperativeName: string
  cooperativeCode: string
  isDemo: boolean
  roleKey: RoleKey
  roleNameEn: string
  roleNameRw: string
  jobTitle: string | null
}

export interface LoginResult {
  accessToken: string
  /** Seconds until `accessToken` expires, so the client can refresh before it does. */
  expiresIn: number
  user: AuthUser
  memberships: Membership[]
}

/**
 * `GET /auth/me`. `cooperative` and `permissions` are filled only when the request named an active
 * cooperative; without one the caller is authenticated but holds no cooperative permissions.
 */
export interface SessionSummary {
  user: AuthUser
  memberships: Membership[]
  cooperative: { id: string; name: string; code: string; isDemo: boolean } | null
  roleKey: RoleKey | null
  permissions: PermissionKey[]
}

/** One signed-in device, as shown on the profile screen. */
export interface SessionDevice {
  id: string
  userAgent: string | null
  ipAddress: string | null
  createdAt: string
  expiresAt: string
  /** True for the session that issued the refresh cookie on this request. */
  current: boolean
}

export interface AuditEntry {
  id: string
  action: string
  entityType: string
  entityId: string | null
  actorLabel: string
  messageKey: string
  messageParams: Record<string, string | number> | null
  createdAt: string
}
