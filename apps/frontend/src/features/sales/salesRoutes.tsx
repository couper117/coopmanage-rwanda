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
const BuyerProfilePage = lazy(async () => {
  await loadNamespaces(['sales'])
  return { default: (await import('@/pages/sales/BuyerProfilePage')).BuyerProfilePage }
})
const BuyersPage = lazy(async () => {
  await loadNamespaces(['sales'])
  return { default: (await import('@/pages/sales/BuyersPage')).BuyersPage }
})
const SaleDetailPage = lazy(async () => {
  await loadNamespaces(['sales'])
  return { default: (await import('@/pages/sales/SaleDetailPage')).SaleDetailPage }
})
const SaleFormPage = lazy(async () => {
  await loadNamespaces(['sales'])
  return { default: (await import('@/pages/sales/SaleFormPage')).SaleFormPage }
})
const SaleReceiptPage = lazy(async () => {
  await loadNamespaces(['sales'])
  return { default: (await import('@/pages/sales/SaleReceiptPage')).SaleReceiptPage }
})
const SalesPage = lazy(async () => {
  await loadNamespaces(['sales'])
  return { default: (await import('@/pages/sales/SalesPage')).SalesPage }
})

/**
 * Sales and buyers, mounted inside the application shell.
 *
 * The guards follow the read permissions the endpoints require: `sales:view` for a sale and
 * `buyers:view` for a buyer. Writing is gated again inside each screen — recording a sale,
 * confirming it, cancelling it and taking a payment are four different permissions, because they
 * are four different decisions — and the server checks every request whatever the interface chose
 * to show.
 *
 * `/sales/new` is registered before `/sales/:id`, so it is not read as a sale whose identifier is
 * the word "new".
 *
 * There is no route for deleting anything. A draft nobody wants is cancelled, a confirmed sale is
 * cancelled with compensating movements, and a buyer is taken out of use.
 *
 * Exported as data rather than as a built router so tests can mount the same tree in a memory
 * router and assert what a user actually sees.
 */
export const salesRoutes: RouteObject[] = [
  {
    path: 'sales',
    element: (
      <RequirePermission permission="sales:view">
        <SalesPage />
      </RequirePermission>
    ),
  },
  {
    path: 'sales/new',
    element: (
      <RequirePermission permission="sales:create">
        <SaleFormPage />
      </RequirePermission>
    ),
  },
  {
    path: 'sales/:id',
    element: (
      <RequirePermission permission="sales:view">
        <SaleDetailPage />
      </RequirePermission>
    ),
  },
  {
    path: 'sales/:id/edit',
    element: (
      <RequirePermission permission="sales:create">
        <SaleFormPage />
      </RequirePermission>
    ),
  },
  {
    path: 'sales/:id/receipt',
    element: (
      <RequirePermission permission="sales:view">
        <SaleReceiptPage />
      </RequirePermission>
    ),
  },
]

/**
 * Buyers, separate because they are reached from the navigation in their own right: somebody
 * keeping the buyer list is doing a different job from somebody recording a sale.
 */
export const buyerRoutes: RouteObject[] = [
  {
    path: 'buyers',
    element: (
      <RequirePermission permission="buyers:view">
        <BuyersPage />
      </RequirePermission>
    ),
  },
  {
    path: 'buyers/:id',
    element: (
      <RequirePermission permission="buyers:view">
        <BuyerProfilePage />
      </RequirePermission>
    ),
  },
]
