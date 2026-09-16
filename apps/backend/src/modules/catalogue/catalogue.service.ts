import type { Prisma, ProductType } from '@prisma/client'
import { writeAudit } from '../../lib/audit.js'
import type { RequestContext } from '../../lib/context.js'
import { isUniqueViolation } from '../../lib/dbErrors.js'
import { AppError } from '../../lib/errors.js'
import { parseMoney, parseQuantity, toWire, ZERO, type Money } from '../../lib/money.js'
import { prisma } from '../../lib/prisma.js'
import type {
  CreateProductCategoryInput,
  CreateProductInput,
  CreateUnitInput,
  CreateWarehouseInput,
  ListProductCategoriesQuery,
  ListProductsQuery,
  ListUnitsQuery,
  ListWarehousesQuery,
  UpdateProductCategoryInput,
  UpdateProductInput,
  UpdateUnitInput,
  UpdateWarehouseInput,
} from './catalogue.schemas.js'

/**
 * The catalogue.
 *
 * Nothing here is ever deleted. A product that is no longer dealt in is retired, a store that has
 * closed is closed, a unit that fell out of use is deactivated — because every one of them is
 * named by movements in the history, and a report covering last season has to be able to say what
 * was received and in what unit.
 */

function requireCooperativeId(ctx: RequestContext): string {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw AppError.noCooperativeAccess()
  return cooperativeId
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export interface UnitRow {
  id: string
  key: string
  nameEn: string
  nameRw: string
  symbol: string
  precision: number
  isActive: boolean
  /** True for a unit the platform seeded, which every cooperative shares and none may rename. */
  isSystem: boolean
  baseUnitId: string | null
  factorToBase: string | null
  productCount: number
}

/**
 * The units available to a cooperative: the ones the platform seeded, plus its own.
 *
 * A system unit has no `cooperative_id`, which is why the query asks for either. Kilograms are not
 * assumed anywhere, but they are offered, because a cooperative should not have to define them
 * before it can record its first delivery.
 */
export async function listUnits(ctx: RequestContext, query: ListUnitsQuery): Promise<UnitRow[]> {
  const cooperativeId = requireCooperativeId(ctx)

  const units = await prisma.unitOfMeasure.findMany({
    where: {
      OR: [{ cooperativeId: null }, { cooperativeId }],
      ...(query.includeInactive === 'true' ? {} : { isActive: true }),
    },
    select: {
      id: true,
      cooperativeId: true,
      key: true,
      nameEn: true,
      nameRw: true,
      symbol: true,
      precision: true,
      isActive: true,
      baseUnitId: true,
      factorToBase: true,
      _count: { select: { products: true } },
    },
    orderBy: [{ cooperativeId: 'asc' }, { key: 'asc' }],
  })

  return units.map((row) => ({
    id: row.id,
    key: row.key,
    nameEn: row.nameEn,
    nameRw: row.nameRw,
    symbol: row.symbol,
    precision: row.precision,
    isActive: row.isActive,
    isSystem: row.cooperativeId === null,
    baseUnitId: row.baseUnitId,
    factorToBase: row.factorToBase === null ? null : row.factorToBase.toString(),
    productCount: row._count.products,
  }))
}

export async function createUnit(ctx: RequestContext, input: CreateUnitInput): Promise<UnitRow> {
  const cooperativeId = requireCooperativeId(ctx)

  if (input.baseUnitId) {
    const base = await prisma.unitOfMeasure.findFirst({
      where: { id: input.baseUnitId, OR: [{ cooperativeId: null }, { cooperativeId }] },
      select: { id: true },
    })
    if (!base) {
      throw AppError.validationFailed([
        { field: 'body.baseUnitId', messageKey: 'validation.invalid_value' },
      ])
    }
  }

  const factorToBase =
    input.factorToBase === undefined
      ? null
      : parseMoney(input.factorToBase, { field: 'body.factorToBase', scale: 6 })

  const created = await prisma.unitOfMeasure
    .create({
      data: {
        cooperativeId,
        key: input.key,
        nameEn: input.nameEn,
        nameRw: input.nameRw,
        symbol: input.symbol,
        precision: input.precision,
        baseUnitId: input.baseUnitId ?? null,
        factorToBase,
      },
      select: { id: true },
    })
    .catch((error: unknown) => {
      if (isUniqueViolation(error, 'key')) throw AppError.duplicate('errors.catalogue.unitKeyTaken')
      throw error
    })

  await writeAudit(
    { ctx },
    {
      action: 'catalogue.unit.created',
      entityType: 'UnitOfMeasure',
      entityId: created.id,
      messageKey: 'audit.catalogue.unitCreated',
      messageParams: {
        unit: input.nameEn,
        unitRw: input.nameRw,
        key: input.key,
      },
      after: { key: input.key, nameEn: input.nameEn, nameRw: input.nameRw },
    },
  )

  return findUnitOrThrow(ctx, created.id)
}

async function findUnitOrThrow(ctx: RequestContext, id: string): Promise<UnitRow> {
  const rows = await listUnits(ctx, { includeInactive: 'true' })
  const row = rows.find((candidate) => candidate.id === id)
  if (!row) throw AppError.notFound()
  return row
}

/**
 * Renames a unit, or takes it out of use.
 *
 * A cooperative may only touch its own. A system unit is shared by every cooperative on the
 * platform, so renaming one here would change what "sack" means for everybody else.
 */
export async function updateUnit(
  ctx: RequestContext,
  id: string,
  input: UpdateUnitInput,
): Promise<UnitRow> {
  const cooperativeId = requireCooperativeId(ctx)
  const existing = await prisma.unitOfMeasure.findFirst({
    where: { id, OR: [{ cooperativeId: null }, { cooperativeId }] },
    select: {
      id: true,
      cooperativeId: true,
      key: true,
      nameEn: true,
      nameRw: true,
      isActive: true,
    },
  })
  if (!existing) throw AppError.notFound()

  if (existing.cooperativeId === null) {
    throw AppError.conflict(
      'errors.catalogue.systemUnit',
      'That unit belongs to the platform and is shared by every cooperative. Add your own instead.',
    )
  }

  await prisma.unitOfMeasure.update({
    where: { id },
    data: {
      ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
      ...(input.nameRw !== undefined ? { nameRw: input.nameRw } : {}),
      ...(input.symbol !== undefined ? { symbol: input.symbol } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  })

  await writeAudit(
    { ctx },
    {
      action: 'catalogue.unit.updated',
      entityType: 'UnitOfMeasure',
      entityId: id,
      messageKey: 'audit.catalogue.unitUpdated',
      messageParams: {
        unit: input.nameEn ?? existing.nameEn,
        unitRw: input.nameRw ?? existing.nameRw,
      },
      before: { nameEn: existing.nameEn, isActive: existing.isActive },
      after: {
        nameEn: input.nameEn ?? existing.nameEn,
        isActive: input.isActive ?? existing.isActive,
      },
    },
  )

  return findUnitOrThrow(ctx, id)
}

// ---------------------------------------------------------------------------
// Product categories
// ---------------------------------------------------------------------------

export interface ProductCategoryRow {
  id: string
  name: string
  nameRw: string | null
  parentId: string | null
  parentName: string | null
  description: string | null
  isActive: boolean
  productCount: number
}

export async function listProductCategories(
  ctx: RequestContext,
  query: ListProductCategoriesQuery,
): Promise<ProductCategoryRow[]> {
  const cooperativeId = requireCooperativeId(ctx)

  const rows = await prisma.productCategory.findMany({
    where: {
      cooperativeId,
      ...(query.includeInactive === 'true' ? {} : { isActive: true }),
    },
    select: {
      id: true,
      name: true,
      nameRw: true,
      parentId: true,
      description: true,
      isActive: true,
      parent: { select: { name: true } },
      _count: { select: { products: true } },
    },
    orderBy: [{ name: 'asc' }],
  })

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    nameRw: row.nameRw,
    parentId: row.parentId,
    parentName: row.parent?.name ?? null,
    description: row.description,
    isActive: row.isActive,
    productCount: row._count.products,
  }))
}

export async function createProductCategory(
  ctx: RequestContext,
  input: CreateProductCategoryInput,
): Promise<ProductCategoryRow> {
  const cooperativeId = requireCooperativeId(ctx)

  if (input.parentId) {
    const parent = await prisma.productCategory.findFirst({
      where: { id: input.parentId, cooperativeId },
      select: { id: true, parentId: true },
    })
    if (!parent) {
      throw AppError.validationFailed([
        { field: 'body.parentId', messageKey: 'validation.invalid_value' },
      ])
    }
    if (parent.parentId) {
      // One level of nesting. A catalogue three deep is a filing system nobody navigates, and the
      // screens are built for two.
      throw AppError.conflict(
        'errors.catalogue.categoryTooDeep',
        'A category can sit under one other, not under a category that already has a parent.',
      )
    }
  }

  const created = await prisma.productCategory
    .create({
      data: {
        cooperativeId,
        name: input.name,
        nameRw: input.nameRw ?? null,
        parentId: input.parentId ?? null,
        description: input.description ?? null,
      },
      select: { id: true },
    })
    .catch((error: unknown) => {
      if (isUniqueViolation(error, 'name', 'parent_id')) {
        throw AppError.duplicate('errors.catalogue.categoryNameTaken')
      }
      throw error
    })

  await writeAudit(
    { ctx },
    {
      action: 'catalogue.category.created',
      entityType: 'ProductCategory',
      entityId: created.id,
      messageKey: 'audit.catalogue.categoryCreated',
      messageParams: { category: input.name, categoryRw: input.nameRw ?? input.name },
      after: { name: input.name, nameRw: input.nameRw ?? null },
    },
  )

  const rows = await listProductCategories(ctx, { includeInactive: 'true' })
  const row = rows.find((candidate) => candidate.id === created.id)
  if (!row) throw AppError.notFound()
  return row
}

export async function updateProductCategory(
  ctx: RequestContext,
  id: string,
  input: UpdateProductCategoryInput,
): Promise<ProductCategoryRow> {
  const cooperativeId = requireCooperativeId(ctx)
  const existing = await prisma.productCategory.findFirst({
    where: { id, cooperativeId },
    select: { id: true, name: true, nameRw: true, isActive: true },
  })
  if (!existing) throw AppError.notFound()

  await prisma.productCategory
    .update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.nameRw !== undefined ? { nameRw: input.nameRw } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    })
    .catch((error: unknown) => {
      if (isUniqueViolation(error, 'name', 'parent_id')) {
        throw AppError.duplicate('errors.catalogue.categoryNameTaken')
      }
      throw error
    })

  await writeAudit(
    { ctx },
    {
      action: 'catalogue.category.updated',
      entityType: 'ProductCategory',
      entityId: id,
      messageKey: 'audit.catalogue.categoryUpdated',
      messageParams: {
        category: input.name ?? existing.name,
        categoryRw: input.nameRw ?? existing.nameRw ?? input.name ?? existing.name,
      },
      before: { name: existing.name, isActive: existing.isActive },
      after: { name: input.name ?? existing.name, isActive: input.isActive ?? existing.isActive },
    },
  )

  const rows = await listProductCategories(ctx, { includeInactive: 'true' })
  const row = rows.find((candidate) => candidate.id === id)
  if (!row) throw AppError.notFound()
  return row
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface ProductRow {
  id: string
  sku: string
  name: string
  nameRw: string | null
  categoryId: string | null
  categoryName: string | null
  unitId: string
  unitSymbol: string
  unitName: string
  type: ProductType
  trackInventory: boolean
  minStockLevel: string | null
  defaultPurchasePrice: string | null
  defaultSalePrice: string | null
  description: string | null
  isActive: boolean
  /** Total held across every store, so the catalogue can say what is there without a second call. */
  quantityOnHand: string | null
  /** True once movements exist, which is what freezes the unit and the counting decision. */
  hasMovements: boolean
}

const PRODUCT_SELECT = {
  id: true,
  sku: true,
  name: true,
  nameRw: true,
  categoryId: true,
  unitId: true,
  type: true,
  trackInventory: true,
  minStockLevel: true,
  defaultPurchasePrice: true,
  defaultSalePrice: true,
  description: true,
  isActive: true,
  category: { select: { name: true } },
  unit: { select: { symbol: true, nameEn: true } },
  _count: { select: { movements: true } },
} as const

type ProductPayload = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>

function toProductRow(row: ProductPayload, onHand: Money | null): ProductRow {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    nameRw: row.nameRw,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    unitId: row.unitId,
    unitSymbol: row.unit.symbol,
    unitName: row.unit.nameEn,
    type: row.type,
    trackInventory: row.trackInventory,
    minStockLevel: row.minStockLevel === null ? null : toWire(row.minStockLevel, 3),
    defaultPurchasePrice:
      row.defaultPurchasePrice === null ? null : toWire(row.defaultPurchasePrice),
    defaultSalePrice: row.defaultSalePrice === null ? null : toWire(row.defaultSalePrice),
    description: row.description,
    isActive: row.isActive,
    quantityOnHand: row.trackInventory ? toWire(onHand ?? ZERO, 3) : null,
    hasMovements: row._count.movements > 0,
  }
}

export async function listProducts(
  ctx: RequestContext,
  query: ListProductsQuery,
): Promise<{ items: ProductRow[]; total: number }> {
  const cooperativeId = requireCooperativeId(ctx)
  const search = query.q?.trim()

  const where: Prisma.ProductWhereInput = {
    cooperativeId,
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.tracked === 'true' ? { trackInventory: true } : {}),
    ...(query.tracked === 'false' ? { trackInventory: false } : {}),
    ...(query.includeInactive === 'true' ? {} : { isActive: true }),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    query.sort === '-name'
      ? [{ name: 'desc' }]
      : query.sort === 'sku'
        ? [{ sku: 'asc' }]
        : query.sort === '-sku'
          ? [{ sku: 'desc' }]
          : [{ name: 'asc' }]

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: PRODUCT_SELECT,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.product.count({ where }),
  ])

  const levels =
    rows.length === 0
      ? []
      : await prisma.stockLevel.groupBy({
          by: ['productId'],
          where: { cooperativeId, productId: { in: rows.map((row) => row.id) } },
          _sum: { quantity: true },
        })
  const onHand = new Map(levels.map((row) => [row.productId, row._sum.quantity]))

  return {
    items: rows.map((row) => toProductRow(row, onHand.get(row.id) ?? null)),
    total,
  }
}

export async function getProduct(ctx: RequestContext, id: string): Promise<ProductRow> {
  const cooperativeId = requireCooperativeId(ctx)
  const row = await prisma.product.findFirst({
    where: { id, cooperativeId },
    select: PRODUCT_SELECT,
  })
  if (!row) throw AppError.notFound()

  const level = await prisma.stockLevel.aggregate({
    where: { cooperativeId, productId: id },
    _sum: { quantity: true },
  })
  return toProductRow(row, level._sum.quantity)
}

/**
 * Builds a code from a name when the cooperative has not got its own.
 *
 * Most cooperatives have no product codes at all, and making somebody invent one before they can
 * record a delivery is friction for nothing. The generated code is readable rather than random,
 * because it ends up on a paper label: "Maize seed" becomes `MAIZE-SEED`, and a collision gets a
 * number.
 */
async function generateSku(cooperativeId: string, name: string): Promise<string> {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'ITEM'

  const taken = await prisma.product.findMany({
    where: { cooperativeId, sku: { startsWith: base } },
    select: { sku: true },
  })
  if (!taken.some((row) => row.sku === base)) return base

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!taken.some((row) => row.sku === candidate)) return candidate
  }
  throw AppError.duplicate('errors.catalogue.skuTaken')
}

export async function createProduct(
  ctx: RequestContext,
  input: CreateProductInput,
): Promise<ProductRow> {
  const cooperativeId = requireCooperativeId(ctx)

  const unit = await prisma.unitOfMeasure.findFirst({
    where: { id: input.unitId, isActive: true, OR: [{ cooperativeId: null }, { cooperativeId }] },
    select: { id: true },
  })
  if (!unit) {
    throw AppError.validationFailed([
      { field: 'body.unitId', messageKey: 'validation.invalid_value' },
    ])
  }

  if (input.categoryId) {
    const category = await prisma.productCategory.findFirst({
      where: { id: input.categoryId, cooperativeId, isActive: true },
      select: { id: true },
    })
    if (!category) {
      throw AppError.validationFailed([
        { field: 'body.categoryId', messageKey: 'validation.invalid_value' },
      ])
    }
  }

  const sku = input.sku ?? (await generateSku(cooperativeId, input.name))

  const created = await prisma.product
    .create({
      data: {
        cooperativeId,
        sku,
        name: input.name,
        nameRw: input.nameRw ?? null,
        categoryId: input.categoryId ?? null,
        unitId: input.unitId,
        type: input.type,
        trackInventory: input.trackInventory,
        minStockLevel:
          input.minStockLevel == null
            ? null
            : parseQuantity(input.minStockLevel, 'body.minStockLevel', { allowZero: true }),
        defaultPurchasePrice:
          input.defaultPurchasePrice == null
            ? null
            : parseMoney(input.defaultPurchasePrice, {
                field: 'body.defaultPurchasePrice',
                allowZero: true,
              }),
        defaultSalePrice:
          input.defaultSalePrice == null
            ? null
            : parseMoney(input.defaultSalePrice, {
                field: 'body.defaultSalePrice',
                allowZero: true,
              }),
        description: input.description ?? null,
        createdById: ctx.user.id,
      },
      select: { id: true },
    })
    .catch((error: unknown) => {
      if (isUniqueViolation(error, 'sku')) throw AppError.duplicate('errors.catalogue.skuTaken')
      throw error
    })

  await writeAudit(
    { ctx },
    {
      action: 'catalogue.product.created',
      entityType: 'Product',
      entityId: created.id,
      messageKey: 'audit.catalogue.productCreated',
      messageParams: { product: input.name, productRw: input.nameRw ?? input.name, sku },
      after: { sku, name: input.name, type: input.type, trackInventory: input.trackInventory },
    },
  )

  return getProduct(ctx, created.id)
}

/**
 * Changes a product.
 *
 * Two fields are frozen once movements exist against it. The unit, because changing it would
 * silently rewrite every quantity already recorded — three hundred kilograms becoming three
 * hundred tonnes — and whether it is counted, because switching a counted product to an uncounted
 * one would abandon its stock level with no movement to explain where the stock went.
 */
export async function updateProduct(
  ctx: RequestContext,
  id: string,
  input: UpdateProductInput,
): Promise<ProductRow> {
  const cooperativeId = requireCooperativeId(ctx)
  const existing = await prisma.product.findFirst({
    where: { id, cooperativeId },
    select: {
      id: true,
      sku: true,
      name: true,
      nameRw: true,
      unitId: true,
      trackInventory: true,
      isActive: true,
      minStockLevel: true,
      _count: { select: { movements: true } },
    },
  })
  if (!existing) throw AppError.notFound()

  const hasMovements = existing._count.movements > 0

  if (hasMovements && input.unitId !== undefined && input.unitId !== existing.unitId) {
    throw AppError.conflict(
      'errors.catalogue.unitFrozen',
      'This product already has movements recorded, so its unit cannot change. Add a new product for the new unit.',
    )
  }
  if (
    hasMovements &&
    input.trackInventory !== undefined &&
    input.trackInventory !== existing.trackInventory
  ) {
    throw AppError.conflict(
      'errors.catalogue.countingFrozen',
      'This product already has movements recorded, so whether it is counted cannot change.',
    )
  }

  const willTrack = input.trackInventory ?? existing.trackInventory
  if (!willTrack && input.minStockLevel != null) {
    throw AppError.validationFailed([
      { field: 'body.minStockLevel', messageKey: 'validation.invalid_value' },
    ])
  }

  if (input.unitId !== undefined) {
    const unit = await prisma.unitOfMeasure.findFirst({
      where: { id: input.unitId, isActive: true, OR: [{ cooperativeId: null }, { cooperativeId }] },
      select: { id: true },
    })
    if (!unit) {
      throw AppError.validationFailed([
        { field: 'body.unitId', messageKey: 'validation.invalid_value' },
      ])
    }
  }

  if (input.categoryId) {
    const category = await prisma.productCategory.findFirst({
      where: { id: input.categoryId, cooperativeId },
      select: { id: true },
    })
    if (!category) {
      throw AppError.validationFailed([
        { field: 'body.categoryId', messageKey: 'validation.invalid_value' },
      ])
    }
  }

  await prisma.product
    .update({
      where: { id },
      data: {
        ...(input.sku !== undefined ? { sku: input.sku } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.nameRw !== undefined ? { nameRw: input.nameRw } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.unitId !== undefined ? { unitId: input.unitId } : {}),
        ...(input.trackInventory !== undefined ? { trackInventory: input.trackInventory } : {}),
        ...(input.minStockLevel !== undefined
          ? {
              minStockLevel:
                input.minStockLevel === null
                  ? null
                  : parseQuantity(input.minStockLevel, 'body.minStockLevel', { allowZero: true }),
            }
          : {}),
        ...(input.defaultPurchasePrice !== undefined
          ? {
              defaultPurchasePrice:
                input.defaultPurchasePrice === null
                  ? null
                  : parseMoney(input.defaultPurchasePrice, {
                      field: 'body.defaultPurchasePrice',
                      allowZero: true,
                    }),
            }
          : {}),
        ...(input.defaultSalePrice !== undefined
          ? {
              defaultSalePrice:
                input.defaultSalePrice === null
                  ? null
                  : parseMoney(input.defaultSalePrice, {
                      field: 'body.defaultSalePrice',
                      allowZero: true,
                    }),
            }
          : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    })
    .catch((error: unknown) => {
      if (isUniqueViolation(error, 'sku')) throw AppError.duplicate('errors.catalogue.skuTaken')
      throw error
    })

  await writeAudit(
    { ctx },
    {
      action: 'catalogue.product.updated',
      entityType: 'Product',
      entityId: id,
      messageKey: 'audit.catalogue.productUpdated',
      messageParams: {
        product: input.name ?? existing.name,
        productRw: input.nameRw ?? existing.nameRw ?? input.name ?? existing.name,
        sku: input.sku ?? existing.sku,
      },
      before: {
        name: existing.name,
        sku: existing.sku,
        isActive: existing.isActive,
        minStockLevel: existing.minStockLevel === null ? null : toWire(existing.minStockLevel, 3),
      },
      after: {
        name: input.name ?? existing.name,
        sku: input.sku ?? existing.sku,
        isActive: input.isActive ?? existing.isActive,
      },
    },
  )

  return getProduct(ctx, id)
}

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

export interface WarehouseRow {
  id: string
  name: string
  code: string
  district: string | null
  sector: string | null
  isDefault: boolean
  isActive: boolean
  /** How many products are sitting in it, so a store cannot be closed unknowingly. */
  productsHeld: number
  quantityHeld: string
}

export async function listWarehouses(
  ctx: RequestContext,
  query: ListWarehousesQuery,
): Promise<WarehouseRow[]> {
  const cooperativeId = requireCooperativeId(ctx)

  const rows = await prisma.warehouse.findMany({
    where: {
      cooperativeId,
      ...(query.includeInactive === 'true' ? {} : { isActive: true }),
    },
    select: {
      id: true,
      name: true,
      code: true,
      district: true,
      sector: true,
      isDefault: true,
      isActive: true,
    },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  })
  if (rows.length === 0) return []

  const held = await prisma.stockLevel.groupBy({
    by: ['warehouseId'],
    where: { cooperativeId, quantity: { gt: 0 } },
    _sum: { quantity: true },
    _count: { _all: true },
  })
  const byWarehouse = new Map(held.map((row) => [row.warehouseId, row]))

  return rows.map((row) => {
    const stock = byWarehouse.get(row.id)
    return {
      ...row,
      productsHeld: stock?._count._all ?? 0,
      quantityHeld: toWire(stock?._sum.quantity ?? ZERO, 3),
    }
  })
}

/**
 * Adds a store.
 *
 * The first one a cooperative creates is its default whatever it asked for, because a movement has
 * to say where it happened and the interface needs somewhere to put stock before anybody has
 * thought about warehouses at all.
 */
export async function createWarehouse(
  ctx: RequestContext,
  input: CreateWarehouseInput,
): Promise<WarehouseRow> {
  const cooperativeId = requireCooperativeId(ctx)
  const existingCount = await prisma.warehouse.count({ where: { cooperativeId } })
  const shouldBeDefault = input.isDefault || existingCount === 0

  const code = input.code ?? (await generateWarehouseCode(cooperativeId, input.name))

  const created = await prisma.$transaction(async (tx) => {
    if (shouldBeDefault) {
      // The partial unique index allows exactly one, so the flag has to be moved rather than set.
      await tx.warehouse.updateMany({
        where: { cooperativeId, isDefault: true },
        data: { isDefault: false },
      })
    }

    return tx.warehouse
      .create({
        data: {
          cooperativeId,
          name: input.name,
          code,
          district: input.district ?? null,
          sector: input.sector ?? null,
          isDefault: shouldBeDefault,
        },
        select: { id: true },
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error, 'code')) {
          throw AppError.duplicate('errors.catalogue.warehouseCodeTaken')
        }
        throw error
      })
  })

  await writeAudit(
    { ctx },
    {
      action: 'catalogue.warehouse.created',
      entityType: 'Warehouse',
      entityId: created.id,
      messageKey: 'audit.catalogue.warehouseCreated',
      messageParams: { warehouse: input.name, code },
      after: { name: input.name, code, isDefault: shouldBeDefault },
    },
  )

  return findWarehouseOrThrow(ctx, created.id)
}

async function generateWarehouseCode(cooperativeId: string, name: string): Promise<string> {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 16) || 'STORE'

  const taken = await prisma.warehouse.findMany({
    where: { cooperativeId, code: { startsWith: base } },
    select: { code: true },
  })
  if (!taken.some((row) => row.code === base)) return base

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!taken.some((row) => row.code === candidate)) return candidate
  }
  throw AppError.duplicate('errors.catalogue.warehouseCodeTaken')
}

async function findWarehouseOrThrow(ctx: RequestContext, id: string): Promise<WarehouseRow> {
  const rows = await listWarehouses(ctx, { includeInactive: 'true' })
  const row = rows.find((candidate) => candidate.id === id)
  if (!row) throw AppError.notFound()
  return row
}

/**
 * Changes a store, including closing it.
 *
 * A store holding stock cannot be closed: the stock would still be there with no screen showing
 * it. Transfer it out first, which the interface says. And the cooperative always keeps exactly one
 * default, so the last remaining default cannot be demoted or closed.
 */
export async function updateWarehouse(
  ctx: RequestContext,
  id: string,
  input: UpdateWarehouseInput,
): Promise<WarehouseRow> {
  const cooperativeId = requireCooperativeId(ctx)
  const existing = await prisma.warehouse.findFirst({
    where: { id, cooperativeId },
    select: { id: true, name: true, code: true, isDefault: true, isActive: true },
  })
  if (!existing) throw AppError.notFound()

  const closing = input.isActive === false && existing.isActive

  if (closing) {
    const holding = await prisma.stockLevel.aggregate({
      where: { warehouseId: id, quantity: { gt: 0 } },
      _sum: { quantity: true },
      _count: { _all: true },
    })
    if ((holding._count._all ?? 0) > 0) {
      throw AppError.conflict(
        'errors.catalogue.warehouseHoldsStock',
        'That store still holds stock. Move it to another store before closing this one.',
      )
    }
    if (existing.isDefault) {
      throw AppError.conflict(
        'errors.catalogue.warehouseIsDefault',
        'That is the default store. Make another store the default before closing it.',
      )
    }
  }

  if (input.isDefault === false && existing.isDefault) {
    throw AppError.conflict(
      'errors.catalogue.warehouseIsDefault',
      'A cooperative always has one default store. Make another store the default instead.',
    )
  }

  await prisma.$transaction(async (tx) => {
    if (input.isDefault === true && !existing.isDefault) {
      await tx.warehouse.updateMany({
        where: { cooperativeId, isDefault: true },
        data: { isDefault: false },
      })
    }

    await tx.warehouse
      .update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.district !== undefined ? { district: input.district } : {}),
          ...(input.sector !== undefined ? { sector: input.sector } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error, 'code')) {
          throw AppError.duplicate('errors.catalogue.warehouseCodeTaken')
        }
        throw error
      })
  })

  await writeAudit(
    { ctx },
    {
      action: 'catalogue.warehouse.updated',
      entityType: 'Warehouse',
      entityId: id,
      messageKey: 'audit.catalogue.warehouseUpdated',
      messageParams: { warehouse: input.name ?? existing.name },
      before: { name: existing.name, isDefault: existing.isDefault, isActive: existing.isActive },
      after: {
        name: input.name ?? existing.name,
        isDefault: input.isDefault ?? existing.isDefault,
        isActive: input.isActive ?? existing.isActive,
      },
    },
  )

  return findWarehouseOrThrow(ctx, id)
}
