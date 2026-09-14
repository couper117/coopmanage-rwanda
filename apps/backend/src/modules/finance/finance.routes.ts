import { createModuleRouter, permission } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { resolveCooperative } from '../../middleware/resolveCooperative.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './finance.controller.js'
import {
  createCategorySchema,
  createTransactionSchema,
  exportTransactionsSchema,
  financeIdSchema,
  listCategoriesSchema,
  listTransactionsSchema,
  summarySchema,
  trendsSchema,
  updateCategorySchema,
  updateTransactionSchema,
  voidTransactionSchema,
} from './finance.schemas.js'

const module = createModuleRouter('')

const tenant = [authenticate, resolveCooperative] as const

/**
 * The cooperative's books.
 *
 * There is no `DELETE` anywhere in this module, for either an entry or a category. A wrong figure
 * is voided, which writes a reversal and leaves both rows in the history; a category that is no
 * longer used is deactivated, because entries already posted against it still have to be able to
 * say where the money went.
 *
 * The fixed paths are registered before `/finance/transactions/:id`, so `/finance/summary` is not
 * read as a transaction whose identifier is the word "summary".
 */
module.get(
  '/finance/summary',
  permission('finance:view'),
  ...tenant,
  requirePermission('finance:view'),
  validate({ query: summarySchema }),
  controller.getSummary,
)

module.get(
  '/finance/trends',
  permission('finance:view'),
  ...tenant,
  requirePermission('finance:view'),
  validate({ query: trendsSchema }),
  controller.getTrends,
)

module.get(
  '/finance/export',
  permission('finance:export'),
  ...tenant,
  requirePermission('finance:export'),
  validate({ query: exportTransactionsSchema }),
  controller.getExport,
)

module.get(
  '/finance/categories',
  permission('finance:view'),
  ...tenant,
  requirePermission('finance:view'),
  validate({ query: listCategoriesSchema }),
  controller.getCategories,
)

module.post(
  '/finance/categories',
  permission('finance:categories:manage'),
  ...tenant,
  requirePermission('finance:categories:manage'),
  validate({ body: createCategorySchema }),
  controller.postCategory,
)

module.patch(
  '/finance/categories/:id',
  permission('finance:categories:manage'),
  ...tenant,
  requirePermission('finance:categories:manage'),
  validate({ params: financeIdSchema, body: updateCategorySchema }),
  controller.patchCategory,
)

module.get(
  '/finance/transactions',
  permission('finance:view'),
  ...tenant,
  requirePermission('finance:view'),
  validate({ query: listTransactionsSchema }),
  controller.getTransactions,
)

module.post(
  '/finance/transactions',
  permission('finance:create'),
  ...tenant,
  requirePermission('finance:create'),
  validate({ body: createTransactionSchema }),
  controller.postTransactionEntry,
)

module.get(
  '/finance/transactions/:id',
  permission('finance:view'),
  ...tenant,
  requirePermission('finance:view'),
  validate({ params: financeIdSchema }),
  controller.getOneTransaction,
)

/**
 * Only the category and the description. The amount, the kind and the date of a posted entry are
 * fixed for good, so a figure can never change under a report that has already been printed.
 */
module.patch(
  '/finance/transactions/:id',
  permission('finance:create'),
  ...tenant,
  requirePermission('finance:create'),
  validate({ params: financeIdSchema, body: updateTransactionSchema }),
  controller.patchTransaction,
)

module.post(
  '/finance/transactions/:id/void',
  permission('finance:void'),
  ...tenant,
  requirePermission('finance:void'),
  validate({ params: financeIdSchema, body: voidTransactionSchema }),
  controller.postVoidTransaction,
)

export const financeRouter = module.router
