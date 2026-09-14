import { z } from 'zod'

/**
 * The catalogue: what the cooperative deals in, and where it keeps it.
 *
 * Two product rules are worth stating, because both are about not assuming what a cooperative
 * does. Nothing here assumes kilograms: a cooperative adds its own units, and a movement records
 * the unit it was made in so a later change cannot rewrite history. And a product need not be
 * counted at all — `trackInventory` is what separates a bag of maize from a day of tractor hire,
 * and a service has no stock level, no minimum and no place on the stock overview.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional()

const decimalString = z.union([z.string().trim().min(1), z.number()])

export const PRODUCT_TYPES = ['GOODS', 'SERVICE'] as const

export const catalogueIdSchema = z.object({ id: z.uuid() }).strict()

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export const listUnitsSchema = z
  .object({ includeInactive: z.enum(['true', 'false']).default('false') })
  .strict()

export type ListUnitsQuery = z.infer<typeof listUnitsSchema>

/**
 * A unit the cooperative adds for itself. The key is how it is referred to in code and on paper,
 * so it is upper case and stable; the two names are what a person reads.
 */
export const createUnitSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[A-Z][A-Z0-9_]*$/, 'a unit key is upper case letters, digits and underscores'),
    nameEn: z.string().trim().min(1).max(60),
    nameRw: z.string().trim().min(1).max(60),
    symbol: z.string().trim().min(1).max(12),
    /** Decimal places. A sack is counted whole; a weight is not. */
    precision: z.coerce.number().int().min(0).max(3).default(2),
    /** Where this unit is a multiple of another: a tonne is a thousand kilograms. */
    baseUnitId: z.uuid().nullable().optional(),
    factorToBase: decimalString.optional(),
  })
  .strict()
  .refine((value) => value.baseUnitId == null || value.factorToBase !== undefined, {
    message: 'a unit built on another has to say how many of it there are',
    path: ['factorToBase'],
  })

export type CreateUnitInput = z.infer<typeof createUnitSchema>

export const updateUnitSchema = z
  .object({
    nameEn: z.string().trim().min(1).max(60).optional(),
    nameRw: z.string().trim().min(1).max(60).optional(),
    symbol: z.string().trim().min(1).max(12).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  })

export type UpdateUnitInput = z.infer<typeof updateUnitSchema>

// ---------------------------------------------------------------------------
// Product categories
// ---------------------------------------------------------------------------

export const listProductCategoriesSchema = z
  .object({ includeInactive: z.enum(['true', 'false']).default('false') })
  .strict()

export type ListProductCategoriesQuery = z.infer<typeof listProductCategoriesSchema>

export const createProductCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    nameRw: optionalText(80),
    parentId: z.uuid().nullable().optional(),
    description: optionalText(280),
  })
  .strict()

export type CreateProductCategoryInput = z.infer<typeof createProductCategorySchema>

export const updateProductCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    nameRw: optionalText(80),
    description: optionalText(280),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  })

export type UpdateProductCategoryInput = z.infer<typeof updateProductCategorySchema>

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const PRODUCT_SORTABLE = ['name', '-name', 'sku', '-sku'] as const

export const listProductsSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    categoryId: z.uuid().optional(),
    type: z.enum(PRODUCT_TYPES).optional(),
    tracked: z.enum(['true', 'false']).optional(),
    includeInactive: z.enum(['true', 'false']).default('false'),
    sort: z.enum(PRODUCT_SORTABLE).default('name'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()

export type ListProductsQuery = z.infer<typeof listProductsSchema>

export const createProductSchema = z
  .object({
    /** Left out to be generated from the name, because most cooperatives have no codes yet. */
    sku: optionalText(40),
    name: z.string().trim().min(1).max(120),
    nameRw: optionalText(120),
    categoryId: z.uuid().nullable().optional(),
    unitId: z.uuid(),
    type: z.enum(PRODUCT_TYPES).default('GOODS'),
    trackInventory: z.boolean().default(true),
    minStockLevel: decimalString.nullable().optional(),
    defaultPurchasePrice: decimalString.nullable().optional(),
    defaultSalePrice: decimalString.nullable().optional(),
    description: optionalText(500),
  })
  .strict()
  .refine((value) => value.trackInventory || value.minStockLevel == null, {
    // A product nobody counts cannot be below a minimum, so offering one would be a promise the
    // low-stock watch could never keep.
    message: 'a product that is not counted cannot have a stock minimum',
    path: ['minStockLevel'],
  })
  .refine((value) => value.type !== 'SERVICE' || !value.trackInventory, {
    message: 'a service is not held in a store, so it is not counted',
    path: ['trackInventory'],
  })

export type CreateProductInput = z.infer<typeof createProductSchema>

/**
 * The unit and whether a product is counted are fixed once movements exist against it.
 *
 * Changing the unit would silently rewrite every quantity already recorded — three hundred
 * kilograms becoming three hundred tonnes — and switching a counted product to an uncounted one
 * would abandon its stock level with no movement to explain where it went. The service refuses
 * both once there is history, which is why they are accepted here and checked there.
 */
export const updateProductSchema = z
  .object({
    sku: z.string().trim().min(1).max(40).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    nameRw: optionalText(120),
    categoryId: z.uuid().nullable().optional(),
    unitId: z.uuid().optional(),
    trackInventory: z.boolean().optional(),
    minStockLevel: decimalString.nullable().optional(),
    defaultPurchasePrice: decimalString.nullable().optional(),
    defaultSalePrice: decimalString.nullable().optional(),
    description: optionalText(500),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  })

export type UpdateProductInput = z.infer<typeof updateProductSchema>

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

export const listWarehousesSchema = z
  .object({ includeInactive: z.enum(['true', 'false']).default('false') })
  .strict()

export type ListWarehousesQuery = z.infer<typeof listWarehousesSchema>

export const createWarehouseSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    code: optionalText(20),
    district: optionalText(60),
    sector: optionalText(60),
    /** Making this the default moves the flag off whichever store held it. */
    isDefault: z.boolean().default(false),
  })
  .strict()

export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>

export const updateWarehouseSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    code: z.string().trim().min(1).max(20).optional(),
    district: optionalText(60),
    sector: optionalText(60),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  })

export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>
