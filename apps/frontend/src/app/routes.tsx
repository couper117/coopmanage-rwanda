import type { RouteObject } from 'react-router-dom'
import { AppShell } from '@/layouts/AppShell'
import { DashboardPage } from '@/pages/DashboardPage'
import { ModulePendingPage } from '@/pages/ModulePendingPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { ALL_NAV_ITEMS } from './navigation'

/**
 * Routes for modules that exist, plus an honest status route for every navigation destination
 * whose module is still to come. Each pending route is replaced by the phase named against it in
 * `navigation.ts`, so none can be quietly forgotten.
 *
 * Exported as data rather than as a built router so tests can mount the same tree in a memory
 * router and assert what a user actually sees.
 */
const pendingRoutes: RouteObject[] = ALL_NAV_ITEMS.filter(
  (item) => item.availableFromPhase > 1,
).map((item) => ({
  path: item.to,
  element: <ModulePendingPage moduleKey={item.key} phase={item.availableFromPhase} />,
}))

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      ...pendingRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
