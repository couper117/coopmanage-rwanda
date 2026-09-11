import type {
  AuthUser,
  Locale,
  LoginResult,
  SessionDevice,
  SessionSummary,
} from '@coopmanage/shared'
import { apiRequest } from '@/lib/apiClient'

/**
 * Every call the authentication screens make. Keeping them here rather than inline in components
 * means a change to the contract is a change to one file, and the components stay about what the
 * user sees.
 *
 * `anonymous: true` marks the calls that must not carry a bearer token or trigger a silent
 * refresh: sending a stale token to the login endpoint would be pointless, and refreshing on its
 * 401 would be worse.
 */
export function login(email: string, password: string): Promise<LoginResult> {
  return apiRequest<LoginResult>('/auth/login', {
    method: 'POST',
    body: { email, password },
    anonymous: true,
  })
}

export function logout(): Promise<void> {
  return apiRequest<void>('/auth/logout', { method: 'POST', anonymous: true })
}

export function fetchSession(): Promise<SessionSummary> {
  return apiRequest<SessionSummary>('/auth/me')
}

export function updateProfile(input: {
  fullName?: string
  phone?: string | null
  locale?: Locale
}): Promise<AuthUser> {
  return apiRequest<AuthUser>('/auth/me', { method: 'PATCH', body: input })
}

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return apiRequest<void>('/auth/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  })
}

export function requestPasswordReset(email: string): Promise<void> {
  return apiRequest<void>('/auth/forgot-password', {
    method: 'POST',
    body: { email },
    anonymous: true,
  })
}

export function resetPassword(token: string, password: string): Promise<void> {
  return apiRequest<void>('/auth/reset-password', {
    method: 'POST',
    body: { token, password },
    anonymous: true,
  })
}

export function listSessions(): Promise<SessionDevice[]> {
  return apiRequest<SessionDevice[]>('/auth/sessions')
}

export function revokeSession(id: string): Promise<void> {
  return apiRequest<void>(`/auth/sessions/${id}`, { method: 'DELETE' })
}
