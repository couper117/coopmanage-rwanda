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
const CategoriesPage = lazy(async () => {
  await loadNamespaces(['finance'])
  return { default: (await import('@/pages/finance/CategoriesPage')).CategoriesPage }
})
const FinanceOverviewPage = lazy(async () => {
  await loadNamespaces(['finance'])
  return { default: (await import('@/pages/finance/FinanceOverviewPage')).FinanceOverviewPage }
})
const LedgerPage = lazy(async () => {
  await loadNamespaces(['finance'])
  return { default: (await import('@/pages/finance/LedgerPage')).LedgerPage }
})

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
