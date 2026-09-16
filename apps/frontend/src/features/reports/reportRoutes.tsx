import { lazy } from 'react'
import type { RouteObject } from 'react-router-dom'
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
const ReportsPage = lazy(async () => {
  await loadNamespaces(['reports'])
  return { default: (await import('@/pages/reports/ReportsPage')).ReportsPage }
})

/**
 * Reports, mounted inside the application shell.
 *
 * One screen. The report is chosen on it rather than through a route per report, because a
 * committee producing the monthly report and then the stock report is doing one job, and sending
 * them back to a menu between the two would be busywork. The period and the report stay as screen
 * state rather than going into the URL: a report takes a member's identifier for the membership
 * report, and that has no place in a browser's history.
 *
 * `reports:view` opens the screen. Producing a file needs `reports:export` as well, checked on the
 * screen and again on every request; and each report needs the permission covering its own data,
 * which the server enforces whatever the interface chose to show.
 */
export const reportRoutes: RouteObject[] = [
  {
    path: 'reports',
    element: (
      <RequirePermission permission="reports:view">
        <ReportsPage />
      </RequirePermission>
    ),
  },
]
