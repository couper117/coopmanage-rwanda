import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { PermissionKey } from '@coopmanage/shared'
import { applyLocale } from '@/i18n'
import { API_BASE_URL } from '@/lib/apiClient'
import { authState, useAuthStore } from '@/stores/authStore'
import { fetchSession } from './auth.api'

/**
 * Restores the session on a cold load.
 *
 * The access token is kept in memory, so a page refresh always starts without one. The `HttpOnly`
 * refresh cookie is what survives, and this exchanges it for a token before anything else runs.
 * Until that finishes the status is `unknown`, which is why the router shows nothing rather than
 * flashing the login screen at somebody who is in fact signed in.
 */
let restoreInFlight: Promise<void> | null = null

export function restoreSession(): Promise<void> {
  // Single-flight, for the same reason the API client's refresh is: presenting a refresh token
  // twice is how a stolen token is detected, and the server responds by revoking the whole
  // family. A second concurrent restore would therefore sign the user out. React's development
  // StrictMode double-invokes effects, so this is not a hypothetical race.
  restoreInFlight ??= performRestore().finally(() => {
    restoreInFlight = null
  })
  return restoreInFlight
}

async function performRestore(): Promise<void> {
  const store = useAuthStore.getState()

  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      credentials: 'include',
    })
    if (!response.ok) {
      store.signedOut()
      return
    }
    const payload = (await response.json()) as { data?: { accessToken?: string } }
    const token = payload.data?.accessToken
    if (typeof token !== 'string') {
      store.signedOut()
      return
    }
    authState.setAccessToken(token)
    await loadSession()
  } catch {
    // No connection at start-up is not the same as being signed out, but there is nothing to show
    // a user who cannot reach the server either. The login screen's own error explains it if they
    // try to sign in.
    store.signedOut()
  }
}

/** Reads `/auth/me` and applies it, including the user's own language preference. */
export async function loadSession(): Promise<void> {
  const summary = await fetchSession()
  useAuthStore.getState().applySession(summary)
  await applyLocale(summary.user.locale)
}

/** Runs the restore once, on mount, for the component that owns the router. */
export function useRestoreSession(): void {
  const status = useAuthStore((state) => state.status)
  useEffect(() => {
    if (status === 'unknown') void restoreSession()
  }, [status])
}

/**
 * `useShallow` is required, not a refinement. A selector that builds a fresh object on every read
 * gives `useSyncExternalStore` a new snapshot each time it checks, which React treats as a change
 * and re-renders in a loop until it gives up.
 */
export function useSession() {
  return useAuthStore(
    useShallow((state) => ({
      status: state.status,
      user: state.user,
      memberships: state.memberships,
      activeCooperativeId: state.activeCooperativeId,
      roleKey: state.roleKey,
    })),
  )
}

export function useIsAuthenticated(): boolean {
  return useAuthStore((state) => state.status === 'authenticated')
}

/**
 * Whether the current user holds a permission in the cooperative they are working in.
 *
 * This hides navigation and disables controls. It is never security: the backend re-checks every
 * request, and `docs/permissions.md` section 6 says so explicitly.
 */
export function usePermission(permission: PermissionKey): boolean {
  return useAuthStore((state) => state.permissions.has(permission))
}

export function useActiveMembership() {
  return useAuthStore((state) =>
    state.memberships.find((row) => row.cooperativeId === state.activeCooperativeId),
  )
}
