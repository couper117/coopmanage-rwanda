import type { RouteObject } from 'react-router-dom'
import { RequirePermission } from '@/features/auth/RequireAuth'
import { MovementsPage } from '@/pages/inventory/MovementsPage'
import { ProductsPage } from '@/pages/inventory/ProductsPage'
import { StockOverviewPage } from '@/pages/inventory/StockOverviewPage'
import { UnitsPage } from '@/pages/inventory/UnitsPage'
import { WarehousesPage } from '@/pages/inventory/WarehousesPage'

/**
 * The store and its catalogue, mounted inside the application shell.
 *
 * Each screen is guarded by the permission its own read endpoint requires, which is not the same
 * permission throughout: stock, movements and the stores need `inventory:view`, while the
 * products and the units are the catalogue and need `products:view`. A store is part of the stock
 * picture rather than of the price list, which is why it sits on the inventory side.
 *
 * The guard is a courtesy to the reader rather than the security boundary. The server checks every
 * request again, and receiving, issuing, correcting, transferring, reversing, and managing
 * products, stores and units are each re-checked against their own permission whatever the
 * interface chose to show. An accountant, for instance, reaches all five screens and is offered
 * none of the four movements.
 *
 * There is no route for deleting anything, because there is no such operation. A movement
 * recorded in error is corrected by writing its opposite and both stay in the history; a product
 * is retired, a store is closed, a unit is put out of service.
 *
 * Exported as data rather than as a built router so tests can mount the same tree in a memory
 * router and assert what a user actually sees.
 */
export const inventoryRoutes: RouteObject[] = [
  {
    path: 'inventory',
    element: (
      <RequirePermission permission="inventory:view">
        <StockOverviewPage />
      </RequirePermission>
    ),
  },
  {
    path: 'inventory/movements',
    element: (
      <RequirePermission permission="inventory:view">
        <MovementsPage />
      </RequirePermission>
    ),
  },
  {
    path: 'inventory/products',
    element: (
      <RequirePermission permission="products:view">
        <ProductsPage />
      </RequirePermission>
    ),
  },
  {
    path: 'inventory/warehouses',
    element: (
      <RequirePermission permission="inventory:view">
        <WarehousesPage />
      </RequirePermission>
    ),
  },
  {
    path: 'inventory/units',
    element: (
      <RequirePermission permission="products:view">
        <UnitsPage />
      </RequirePermission>
    ),
  },
]
