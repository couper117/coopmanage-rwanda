import type { RouteObject } from 'react-router-dom'
import { RequireAuth, RequirePermission } from '@/features/auth/RequireAuth'
import { AppShell } from '@/layouts/AppShell'
import { AuditLogPage } from '@/pages/AuditLogPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { ModulePendingPage } from '@/pages/ModulePendingPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { adminRoutes } from '@/features/admin/adminRoutes'
import { financeRoutes } from '@/features/finance/financeRoutes'
import { inventoryRoutes } from '@/features/inventory/inventoryRoutes'
import { reportRoutes } from '@/features/reports/reportRoutes'
import { buyerRoutes, salesRoutes } from '@/features/sales/salesRoutes'
import { contributionRoutes, memberRoutes } from '@/features/members/memberRoutes'
import { CooperativeSettingsPage } from '@/pages/settings/CooperativeSettingsPage'
import { PreferencesPage } from '@/pages/settings/PreferencesPage'
import { StaffPage } from '@/pages/settings/StaffPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'
import { ALL_NAV_ITEMS } from './navigation'

/**
 * Three kinds of route.
 *
 * The authentication screens are public, because they are how a session begins. Everything else
 * sits behind `RequireAuth`, inside the application shell. A screen whose module has not been
 * built yet keeps an honest status route, replaced by the phase named against it in
 * `navigation.ts`, so none can be quietly forgotten.
 *
 * Exported as data rather than as a built router so tests can mount the same tree in a memory
 * router and assert what a user actually sees.
 */

/**
 * The screens that exist, by path, so a module still waiting for its phase keeps its status route
 * and one that has arrived loses it automatically. Deriving the set from the routes themselves
 * means adding a screen cannot leave a placeholder shadowing it.
 */
const BUILT_PATHS = new Set(
  [
    ...memberRoutes,
    ...contributionRoutes,
    ...financeRoutes,
    ...inventoryRoutes,
    ...salesRoutes,
    ...buyerRoutes,
    ...reportRoutes,
  ]
    .map((route) => route.path)
    .filter((path): path is string => path !== undefined)
    .map((path) => (path.startsWith('/') ? path : `/${path}`)),
)

const pendingRoutes: RouteObject[] = ALL_NAV_ITEMS.filter(
  (item) => item.availableFromPhase > 3 && !BUILT_PATHS.has(item.to),
).map((item) => ({
  path: item.to,
  element: <ModulePendingPage moduleKey={item.key} phase={item.availableFromPhase} />,
}))

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password/:token', element: <ResetPasswordPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'profile', element: <ProfilePage /> },
      {
        path: 'settings/cooperative',
        element: (
          <RequirePermission permission="cooperative:view">
            <CooperativeSettingsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'settings/preferences',
        element: (
          <RequirePermission permission="cooperative:view">
            <PreferencesPage />
          </RequirePermission>
        ),
      },
      {
        path: 'settings/staff',
        element: (
          <RequirePermission permission="staff:view">
            <StaffPage />
          </RequirePermission>
        ),
      },
      ...memberRoutes,
      ...contributionRoutes,
      ...financeRoutes,
      ...inventoryRoutes,
      ...salesRoutes,
      ...buyerRoutes,
      ...reportRoutes,
      ...adminRoutes,
      {
        path: 'settings/audit',
        element: (
          <RequirePermission permission="audit:view">
            <AuditLogPage />
          </RequirePermission>
        ),
      },
      ...pendingRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
