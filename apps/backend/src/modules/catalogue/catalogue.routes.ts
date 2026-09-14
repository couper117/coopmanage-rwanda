import { createModuleRouter, permission } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import { requirePermission } from '../../middleware/requirePermission.js'
import { resolveCooperative } from '../../middleware/resolveCooperative.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './catalogue.controller.js'
import {
  catalogueIdSchema,
  createProductCategorySchema,
  createProductSchema,
  createUnitSchema,
  createWarehouseSchema,
  listProductCategoriesSchema,
  listProductsSchema,
  listUnitsSchema,
  listWarehousesSchema,
  updateProductCategorySchema,
  updateProductSchema,
  updateUnitSchema,
  updateWarehouseSchema,
} from './catalogue.schemas.js'

const module = createModuleRouter('')

const tenant = [authenticate, resolveCooperative] as const

/**
 * What the cooperative deals in, and where it keeps it.
 *
 * There is no `DELETE` anywhere here. A product is retired, a store is closed, a unit is
 * deactivated — because each one is named by movements in the immutable history, and a report
 * covering last season has to be able to say what was received and in what unit.
 *
 * Reading the catalogue needs `products:view`; reading the stores needs `inventory:view`, because
 * a store is part of the stock picture rather than the price list. Changing a unit or a store is
 * gated separately again, since those are decisions a storekeeper does not make.
 */
module.get(
  '/units',
  permission('products:view'),
  ...tenant,
  requirePermission('products:view'),
  validate({ query: listUnitsSchema }),
  controller.getUnits,
)

module.post(
  '/units',
  permission('units:manage'),
  ...tenant,
  requirePermission('units:manage'),
  validate({ body: createUnitSchema }),
  controller.postUnit,
)

module.patch(
  '/units/:id',
  permission('units:manage'),
  ...tenant,
  requirePermission('units:manage'),
  validate({ params: catalogueIdSchema, body: updateUnitSchema }),
  controller.patchUnit,
)

module.get(
  '/product-categories',
  permission('products:view'),
  ...tenant,
  requirePermission('products:view'),
  validate({ query: listProductCategoriesSchema }),
  controller.getProductCategories,
)

module.post(
  '/product-categories',
  permission('products:manage'),
  ...tenant,
  requirePermission('products:manage'),
  validate({ body: createProductCategorySchema }),
  controller.postProductCategory,
)

module.patch(
  '/product-categories/:id',
  permission('products:manage'),
  ...tenant,
  requirePermission('products:manage'),
  validate({ params: catalogueIdSchema, body: updateProductCategorySchema }),
  controller.patchProductCategory,
)

module.get(
  '/products',
  permission('products:view'),
  ...tenant,
  requirePermission('products:view'),
  validate({ query: listProductsSchema }),
  controller.getProducts,
)

module.post(
  '/products',
  permission('products:manage'),
  ...tenant,
  requirePermission('products:manage'),
  validate({ body: createProductSchema }),
  controller.postProduct,
)

module.get(
  '/products/:id',
  permission('products:view'),
  ...tenant,
  requirePermission('products:view'),
  validate({ params: catalogueIdSchema }),
  controller.getOneProduct,
)

module.patch(
  '/products/:id',
  permission('products:manage'),
  ...tenant,
  requirePermission('products:manage'),
  validate({ params: catalogueIdSchema, body: updateProductSchema }),
  controller.patchProduct,
)

module.get(
  '/warehouses',
  permission('inventory:view'),
  ...tenant,
  requirePermission('inventory:view'),
  validate({ query: listWarehousesSchema }),
  controller.getWarehouses,
)

module.post(
  '/warehouses',
  permission('warehouses:manage'),
  ...tenant,
  requirePermission('warehouses:manage'),
  validate({ body: createWarehouseSchema }),
  controller.postWarehouse,
)

module.patch(
  '/warehouses/:id',
  permission('warehouses:manage'),
  ...tenant,
  requirePermission('warehouses:manage'),
  validate({ params: catalogueIdSchema, body: updateWarehouseSchema }),
  controller.patchWarehouse,
)

export const catalogueRouter = module.router
