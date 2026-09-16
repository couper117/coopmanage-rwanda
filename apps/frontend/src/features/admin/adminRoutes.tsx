import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'
import { Navigate } from 'react-router-dom'
import { RequirePermission } from '@/features/auth/RequireAuth'
import { loadNamespaces } from '@/i18n'

/**
 * Every screen here is loaded on demand.
 *
 * `lazy` rather than a direct import, so the first page a cooperative opens does not carry the code
 * for the screens it did not ask for. The shell holds the one `Suspense` boundary and shows the
 * same skeleton the screens use for their own data, so a navigation looks like one wait rather than
 * two.
 *
 * The loader awaits the screen's **strings** as well as its code, so a screen never renders
 * with its translation keys showing and then corrects itself. `docs/ui-system.md` §13 records it.
 */
const AdminCooperativesPage = lazy(async () => {
  await loadNamespaces(['admin'])
  return { default: (await import('@/pages/admin/AdminCooperativesPage')).AdminCooperativesPage }
})
const AdminHealthPage = lazy(async () => {
  await loadNamespaces(['admin'])
  return { default: (await import('@/pages/admin/AdminHealthPage')).AdminHealthPage }
})
const AdminSettingsPage = lazy(async () => {
  await loadNamespaces(['admin'])
  return { default: (await import('@/pages/admin/AdminSettingsPage')).AdminSettingsPage }
})
const AdminUsersPage = lazy(async () => {
  await loadNamespaces(['admin'])
  return { default: (await import('@/pages/admin/AdminUsersPage')).AdminUsersPage }
})

/**
 * Platform administration, mounted inside the application shell.
 *
 * Each screen is guarded by the permission its own endpoints require, so a platform operator who
 * holds only some of the `platform:*` keys sees exactly the screens they can use. The guard is a
 * courtesy to the user, never the security boundary: every request is checked again on the server,
 * where the whole `/admin` surface answers 404 to somebody who is not a platform administrator.
 *
 * `/admin` on its own is sent to the cooperative list, which is where an operator almost always
 * means to go.
 */
export const adminRoutes: RouteObject[] = [
  { path: 'admin', element: <Navigate to="/admin/cooperatives" replace /> },
  {
    path: 'admin/cooperatives',
    element: (
      <RequirePermission permission="platform:cooperatives:view">
        <AdminCooperativesPage />
      </RequirePermission>
    ),
  },
  {
    path: 'admin/users',
    element: (
      <RequirePermission permission="platform:users:view">
        <AdminUsersPage />
      </RequirePermission>
    ),
  },
  {
    path: 'admin/settings',
    element: (
      <RequirePermission permission="platform:settings:manage">
        <AdminSettingsPage />
      </RequirePermission>
    ),
  },
  {
    path: 'admin/health',
    element: (
      <RequirePermission permission="platform:health:view">
        <AdminHealthPage />
      </RequirePermission>
    ),
  },
]
