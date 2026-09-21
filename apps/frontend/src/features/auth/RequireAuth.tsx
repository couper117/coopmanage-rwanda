import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { PermissionKey } from '@coopmanage/shared'
import { useAuthStore } from '@/stores/authStore'
import { ForbiddenPage } from '@/pages/ForbiddenPage'
import { SessionLoading } from './SessionLoading'

/**
 * The guard on every screen inside the application shell.
 *
 * While the session is still being restored it shows a quiet loading state rather than the login
 * screen: a signed-in user reloading the page must not see a login form flash past, and a form
 * that appears and vanishes is how people end up typing a password into nothing.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status)
  const mustChangePassword = useAuthStore((state) => state.user?.mustChangePassword ?? false)
  const location = useLocation()

  if (status === 'unknown') return <SessionLoading />
  if (status === 'anonymous') {
    // Where they were going is remembered, so signing in takes them there rather than to the
    // dashboard and a second navigation.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  // An account still on a password somebody else chose is held at the change-password screen.
  // The server refuses everything else in the meantime, so this is a courtesy, not the lock.
  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }
  return <>{children}</>
}

/**
 * A screen-level permission check. The user is signed in; they simply may not see this page, which
 * is a different situation from not being signed in and deserves a different answer.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: PermissionKey
  children: ReactNode
}) {
  const allowed = useAuthStore((state) => state.permissions.has(permission))
  const ready = useAuthStore((state) => state.roleKey !== null)

  if (!ready) return <SessionLoading />
  return allowed ? <>{children}</> : <ForbiddenPage permission={permission} />
}
