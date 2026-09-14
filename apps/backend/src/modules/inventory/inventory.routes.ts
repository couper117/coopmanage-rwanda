import { createModuleRouter, permission } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requireAllPermissions, requirePermission } from '../../middleware/requirePermission.js'
import { resolveCooperative } from '../../middleware/resolveCooperative.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './inventory.controller.js'
import {
  adjustSchema,
  inventoryIdSchema,
  issueSchema,
  listMovementsSchema,
  listStockSchema,
  receiveSchema,
  reverseSchema,
  transferSchema,
} from './inventory.schemas.js'

const module = createModuleRouter('')

const tenant = [authenticate, resolveCooperative] as const

/**
 * The store.
 *
 * Each of the four movements has its own permission, because they are different jobs: a
 * storekeeper receives and issues all day, and correcting a count or moving stock between stores
 * is a decision somebody is accountable for. Reversing a movement is gated behind the adjustment
 * permission for the same reason.
 *
 * There is no `DELETE`. A movement recorded in error is reversed by an opposite movement that
 * points at it, and both stay in the history, which is what makes a shortfall auditable.
 *
 * The fixed paths come before the parameterised one, so `/inventory/low-stock` is not read as a
 * movement whose identifier is the phrase "low-stock".
 */
module.get(
  '/inventory/stock',
  permission('inventory:view'),
  ...tenant,
  requirePermission('inventory:view'),
  validate({ query: listStockSchema }),
  controller.getStock,
)

module.get(
  '/inventory/low-stock',
  permission('inventory:view'),
  ...tenant,
  requirePermission('inventory:view'),
  validate({ query: listStockSchema }),
  controller.getLowStock,
)

module.get(
  '/inventory/transactions',
  permission('inventory:view'),
  ...tenant,
  requirePermission('inventory:view'),
  validate({ query: listMovementsSchema }),
  controller.getMovements,
)

/**
 * What the stock is worth, which is a money question as much as a stock one: it needs both
 * permissions, because a storekeeper who may count sacks is not thereby entitled to know what the
 * cooperative paid for them.
 */
module.get(
  '/inventory/valuation',
  permission('inventory:view'),
  ...tenant,
  requireAllPermissions('inventory:view', 'finance:view'),
  controller.getValuation,
)

module.post(
  '/inventory/receive',
  permission('inventory:receive'),
  ...tenant,
  requirePermission('inventory:receive'),
  validate({ body: receiveSchema }),
  controller.postReceive,
)

module.post(
  '/inventory/issue',
  permission('inventory:issue'),
  ...tenant,
  requirePermission('inventory:issue'),
  validate({ body: issueSchema }),
  controller.postIssue,
)

module.post(
  '/inventory/adjust',
  permission('inventory:adjust'),
  ...tenant,
  requirePermission('inventory:adjust'),
  validate({ body: adjustSchema }),
  controller.postAdjust,
)

module.post(
  '/inventory/transfer',
  permission('inventory:transfer'),
  ...tenant,
  requirePermission('inventory:transfer'),
  validate({ body: transferSchema }),
  controller.postTransfer,
)

module.post(
  '/inventory/transactions/:id/reverse',
  permission('inventory:adjust'),
  ...tenant,
  requirePermission('inventory:adjust'),
  validate({ params: inventoryIdSchema, body: reverseSchema }),
  controller.postReverse,
)

export const inventoryRouter = module.router
