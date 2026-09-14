import { createModuleRouter, permission } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requireAllPermissions, requirePermission } from '../../middleware/requirePermission.js'
import { resolveCooperative } from '../../middleware/resolveCooperative.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './sales.controller.js'
import {
  cancelSaleSchema,
  confirmSaleSchema,
  createBuyerSchema,
  createSaleSchema,
  listBuyersSchema,
  listSalesSchema,
  recordPaymentSchema,
  saleIdSchema,
  salesSummarySchema,
  updateBuyerSchema,
  updateSaleSchema,
} from './sales.schemas.js'

const module = createModuleRouter('')

const tenant = [authenticate, resolveCooperative] as const

/**
 * Buyers and sales.
 *
 * The permissions follow who does what: recording a sale and confirming it are separate, because
 * confirmation takes stock out of the store and records money, and cancelling a confirmed sale is
 * separate again. A person who may write up a sale is not thereby entitled to complete it.
 *
 * There is no `DELETE`. A draft nobody wants is cancelled, a confirmed sale is cancelled with
 * compensating movements, and a buyer is taken out of use — because every confirmed sale names
 * them and a report covering last season has to be able to say who bought the maize.
 *
 * `/sales/summary` is registered before `/sales/:id`, so it is not read as a sale whose identifier
 * is the word "summary".
 */
module.get(
  '/buyers',
  permission('buyers:view'),
  ...tenant,
  requirePermission('buyers:view'),
  validate({ query: listBuyersSchema }),
  controller.getBuyers,
)

module.post(
  '/buyers',
  permission('buyers:manage'),
  ...tenant,
  requirePermission('buyers:manage'),
  validate({ body: createBuyerSchema }),
  controller.postBuyer,
)

module.get(
  '/buyers/:id',
  permission('buyers:view'),
  ...tenant,
  requirePermission('buyers:view'),
  validate({ params: saleIdSchema }),
  controller.getOneBuyer,
)

module.patch(
  '/buyers/:id',
  permission('buyers:manage'),
  ...tenant,
  requirePermission('buyers:manage'),
  validate({ params: saleIdSchema, body: updateBuyerSchema }),
  controller.patchBuyer,
)

/** A buyer's history, which is a sales question as much as a buyer one. */
module.get(
  '/buyers/:id/summary',
  permission('buyers:view'),
  ...tenant,
  requireAllPermissions('buyers:view', 'sales:view'),
  validate({ params: saleIdSchema }),
  controller.getBuyerSummary,
)

module.get(
  '/sales/summary',
  permission('sales:view'),
  ...tenant,
  requirePermission('sales:view'),
  validate({ query: salesSummarySchema }),
  controller.getSalesSummary,
)

module.get(
  '/sales',
  permission('sales:view'),
  ...tenant,
  requirePermission('sales:view'),
  validate({ query: listSalesSchema }),
  controller.getSales,
)

module.post(
  '/sales',
  permission('sales:create'),
  ...tenant,
  requirePermission('sales:create'),
  validate({ body: createSaleSchema }),
  controller.postSale,
)

module.get(
  '/sales/:id',
  permission('sales:view'),
  ...tenant,
  requirePermission('sales:view'),
  validate({ params: saleIdSchema }),
  controller.getOneSale,
)

/** Only while it is a draft. A confirmed sale has left the store and been paid against. */
module.patch(
  '/sales/:id',
  permission('sales:create'),
  ...tenant,
  requirePermission('sales:create'),
  validate({ params: saleIdSchema, body: updateSaleSchema }),
  controller.patchSale,
)

module.post(
  '/sales/:id/confirm',
  permission('sales:confirm'),
  ...tenant,
  requirePermission('sales:confirm'),
  validate({ params: saleIdSchema, body: confirmSaleSchema }),
  controller.postConfirm,
)

module.post(
  '/sales/:id/cancel',
  permission('sales:cancel'),
  ...tenant,
  requirePermission('sales:cancel'),
  validate({ params: saleIdSchema, body: cancelSaleSchema }),
  controller.postCancel,
)

/**
 * Recording money received. Gated on `finance:create` rather than on a sales permission, because
 * it writes an entry into the cooperative's books.
 */
module.post(
  '/sales/:id/payments',
  permission('finance:create'),
  ...tenant,
  requirePermission('finance:create'),
  validate({ params: saleIdSchema, body: recordPaymentSchema }),
  controller.postPayment,
)

module.get(
  '/sales/:id/receipt',
  permission('sales:view'),
  ...tenant,
  requirePermission('sales:view'),
  validate({ params: saleIdSchema }),
  controller.getReceipt,
)

export const salesRouter = module.router
