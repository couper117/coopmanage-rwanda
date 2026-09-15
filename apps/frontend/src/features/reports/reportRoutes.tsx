import type { RouteObject } from 'react-router-dom'
import { RequirePermission } from '@/features/auth/RequireAuth'
import { ReportsPage } from '@/pages/reports/ReportsPage'

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
