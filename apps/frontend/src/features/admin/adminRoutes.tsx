import type { RouteObject } from 'react-router-dom'
import { Navigate } from 'react-router-dom'
import { RequirePermission } from '@/features/auth/RequireAuth'
import { AdminCooperativesPage } from '@/pages/admin/AdminCooperativesPage'
import { AdminHealthPage } from '@/pages/admin/AdminHealthPage'
import { AdminSettingsPage } from '@/pages/admin/AdminSettingsPage'
import { AdminUsersPage } from '@/pages/admin/AdminUsersPage'

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
