import type { RouteObject } from 'react-router-dom'
import { RequirePermission } from '@/features/auth/RequireAuth'
import { CategoriesPage } from '@/pages/finance/CategoriesPage'
import { FinanceOverviewPage } from '@/pages/finance/FinanceOverviewPage'
import { LedgerPage } from '@/pages/finance/LedgerPage'

/**
 * The cooperative's books, mounted inside the application shell.
 *
 * All three screens are guarded by `finance:view`, which is the permission their read endpoints
 * require — including the categories screen, whose list is readable by anybody who can read the
 * books and only editable with `finance:categories:manage`. The guard is a courtesy to the reader
 * rather than the security boundary: the server checks every request again, and recording,
 * voiding, exporting and managing categories are each re-checked against their own permission
 * whatever the interface chose to show.
 *
 * There is no route for deleting an entry or a category, because there is no such operation. An
 * entry recorded in error is voided, which writes a reversal and leaves both rows in the history;
 * a category that has fallen out of use is deactivated.
 *
 * Exported as data rather than as a built router so tests can mount the same tree in a memory
 * router and assert what a user actually sees.
 */
export const financeRoutes: RouteObject[] = [
  {
    path: 'finance',
    element: (
      <RequirePermission permission="finance:view">
        <FinanceOverviewPage />
      </RequirePermission>
    ),
  },
  {
    path: 'finance/transactions',
    element: (
      <RequirePermission permission="finance:view">
        <LedgerPage />
      </RequirePermission>
    ),
  },
  {
    path: 'finance/categories',
    element: (
      <RequirePermission permission="finance:view">
        <CategoriesPage />
      </RequirePermission>
    ),
  },
]
