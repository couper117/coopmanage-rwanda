import { lazy, Suspense, type ReactNode } from 'react'
import type { RouteObject } from 'react-router-dom'
import { RequireAuth, RequirePermission } from '@/features/auth/RequireAuth'
import { AppShell } from '@/layouts/AppShell'
import { DashboardPage } from '@/pages/DashboardPage'
import { ModulePendingPage } from '@/pages/ModulePendingPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { adminRoutes } from '@/features/admin/adminRoutes'
import { announcementRoutes } from '@/features/announcements/announcementRoutes'
import { financeRoutes } from '@/features/finance/financeRoutes'
import { documentRoutes } from '@/features/documents/documentRoutes'
import { inventoryRoutes } from '@/features/inventory/inventoryRoutes'
import { meetingRoutes } from '@/features/meetings/meetingRoutes'
import { reportRoutes } from '@/features/reports/reportRoutes'
import { buyerRoutes, salesRoutes } from '@/features/sales/salesRoutes'
import { contributionRoutes, memberRoutes } from '@/features/members/memberRoutes'
import { LoginPage } from '@/pages/auth/LoginPage'
import { AUDIT_MESSAGE_NAMESPACES, loadNamespaces } from '@/i18n'
import { ALL_NAV_ITEMS } from './navigation'

/**
 * The screens that are loaded on demand.
 *
 * The dashboard, the module placeholder, the not-found page and the sign-in screen stay eager:
 * they are the first thing a session renders, and splitting them would add a round trip to the
 * very moment this product is judged on. Everything else a cooperative navigates to is fetched
 * when it is asked for — its code and its strings together, so a screen never renders with its
 * translation keys showing. `docs/ui-system.md` §13 records the rule.
 */
const AuditLogPage = lazy(async () => {
  // Not just `audit`: an entry quotes the module that wrote it, so the activity log needs the
  // strings of nearly every module to avoid printing a key at a reader. `AUDIT_MESSAGE_NAMESPACES`
  // says which, and why.
  await loadNamespaces(AUDIT_MESSAGE_NAMESPACES)
  return { default: (await import('@/pages/AuditLogPage')).AuditLogPage }
})
/**
 * The notification centre.
 *
 * Its strings are the audit namespaces, because a notification quotes whichever module raised it —
 * the same reason the activity log loads them, recorded in `AUDIT_MESSAGE_NAMESPACES`.
 */
const NotificationsPage = lazy(async () => {
  await loadNamespaces(AUDIT_MESSAGE_NAMESPACES)
  return { default: (await import('@/pages/NotificationsPage')).NotificationsPage }
})

const ProfilePage = lazy(async () => {
  await loadNamespaces(['profile'])
  return { default: (await import('@/pages/ProfilePage')).ProfilePage }
})
const CooperativeSettingsPage = lazy(async () => {
  await loadNamespaces(['settings'])
  return {
    default: (await import('@/pages/settings/CooperativeSettingsPage')).CooperativeSettingsPage,
  }
})
const PreferencesPage = lazy(async () => {
  await loadNamespaces(['settings'])
  return { default: (await import('@/pages/settings/PreferencesPage')).PreferencesPage }
})
const StaffPage = lazy(async () => {
  await loadNamespaces(['staff', 'settings'])
  return { default: (await import('@/pages/settings/StaffPage')).StaffPage }
})

/**
 * The authentication screens are lazy too, and for the opposite reason: a signed-in cooperative
 * never loads them, and they carry their own forms and validation.
 */
const ForgotPasswordPage = lazy(async () => ({
  default: (await import('@/pages/auth/ForgotPasswordPage')).ForgotPasswordPage,
}))
const ResetPasswordPage = lazy(async () => ({
  default: (await import('@/pages/auth/ResetPasswordPage')).ResetPasswordPage,
}))

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
    ...documentRoutes,
    ...meetingRoutes,
    ...announcementRoutes,
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

/**
 * The authentication screens have no shell above them, so they carry their own boundary.
 *
 * A bare `Suspense` with no visible fallback: these screens are small and the page they replace is
 * a full-height centred card, so a skeleton flashing in the middle of an empty page would be more
 * distracting than a moment of nothing.
 */
function Anonymous({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>
}

export const routes: RouteObject[] = [
  // Eager: signing in is the first thing that happens, and a round trip before the form appears
  // is the worst possible first impression of a product used over a district office connection.
  { path: '/login', element: <LoginPage /> },
  {
    path: '/forgot-password',
    element: (
      <Anonymous>
        <ForgotPasswordPage />
      </Anonymous>
    ),
  },
  {
    path: '/reset-password/:token',
    element: (
      <Anonymous>
        <ResetPasswordPage />
      </Anonymous>
    ),
  },
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
      ...documentRoutes,
      ...meetingRoutes,
      ...announcementRoutes,
      ...adminRoutes,
      {
        path: 'notifications',
        element: (
          <RequirePermission permission="notifications:view">
            <NotificationsPage />
          </RequirePermission>
        ),
      },
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
