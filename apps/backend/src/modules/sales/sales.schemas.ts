import { z } from 'zod'
import { RWANDA_PROVINCES } from '@coopmanage/shared'

/**
 * Buyers and sales.
 *
 * The rule that shapes the whole sale schema: **a sale is a draft until somebody confirms it.**
 * Nothing leaves the store and no money is recorded while it is a draft, so the lines can be
 * edited freely, and confirmation is the single act that makes it real. Once confirmed it can
 * never return to draft — it is cancelled, which writes compensating movements.
 *
 * Money and quantities are decimal strings here and decimals in the database, never floats. A
 * sale is arithmetic a cooperative will be held to by a buyer.
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

export const saleIdSchema = z.object({ id: z.uuid() }).strict()

// ---------------------------------------------------------------------------
// Buyers
// ---------------------------------------------------------------------------

export const listBuyersSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    includeInactive: z.enum(['true', 'false']).default('false'),
    sort: z.enum(['name', '-name']).default('name'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()

export type ListBuyersQuery = z.infer<typeof listBuyersSchema>

/**
 * A buyer needs a name and nothing else, for the same reason a member does: whoever records a sale
 * at the store has the buyer's name and may have nothing else, and refusing the sale until
 * somebody finds a telephone number would mean the sale goes unrecorded.
 */
export const createBuyerSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    organization: optionalText(120),
    contactPerson: optionalText(120),
    phone: optionalText(30),
    email: optionalText(160),
    tin: optionalText(30),
    province: z.enum(RWANDA_PROVINCES).nullable().optional(),
    district: optionalText(60),
    sector: optionalText(60),
    address: optionalText(280),
    notes: optionalText(500),
  })
  .strict()

export type CreateBuyerInput = z.infer<typeof createBuyerSchema>

export const updateBuyerSchema = createBuyerSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  })

export type UpdateBuyerInput = z.infer<typeof updateBuyerSchema>

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export const SALE_STATUSES = ['DRAFT', 'CONFIRMED', 'CANCELLED'] as const
export const PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const
export const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK', 'CHEQUE', 'OTHER'] as const

const saleLineSchema = z
  .object({
    productId: z.uuid(),
    quantity: decimalString,
    unitPrice: decimalString,
    note: optionalText(280),
  })
  .strict()

export const createSaleSchema = z
  .object({
    buyerId: z.uuid(),
    warehouseId: z.uuid(),
    saleDate: z.iso.date().optional(),
    /** At least one line: a sale of nothing is not a sale. */
    lines: z.array(saleLineSchema).min(1).max(100),
    discount: decimalString.optional(),
    taxAmount: decimalString.optional(),
    note: optionalText(500),
  })
  .strict()

export type CreateSaleInput = z.infer<typeof createSaleSchema>

/**
 * Editing a draft. The lines are replaced wholesale rather than patched one at a time, because a
 * sale is read and corrected as a whole and a line-by-line protocol would leave the subtotal
 * disagreeing with the lines between two requests.
 */
export const updateSaleSchema = z
  .object({
    buyerId: z.uuid().optional(),
    warehouseId: z.uuid().optional(),
    saleDate: z.iso.date().optional(),
    lines: z.array(saleLineSchema).min(1).max(100).optional(),
    discount: decimalString.optional(),
    taxAmount: decimalString.optional(),
    note: optionalText(500),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  })

export type UpdateSaleInput = z.infer<typeof updateSaleSchema>

/**
 * Confirming. A payment may be taken at the same time, which is the common case at a store
 * counter, and then the income entry is written in the same transaction as the stock movements.
 */
export const confirmSaleSchema = z
  .object({
    amountPaid: decimalString.optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    /** Which income category the money lands in. Required when a payment is taken. */
    incomeCategoryId: z.uuid().optional(),
  })
  .strict()
  .refine((value) => value.amountPaid === undefined || value.incomeCategoryId !== undefined, {
    message: 'a payment has to say which income category it belongs to',
    path: ['incomeCategoryId'],
  })

export type ConfirmSaleInput = z.infer<typeof confirmSaleSchema>

export const cancelSaleSchema = z
  .object({
    /** Required. A cancelled sale that cannot be explained is one nobody can audit. */
    reason: z.string().trim().min(1).max(280),
  })
  .strict()

export const recordPaymentSchema = z
  .object({
    amount: decimalString,
    method: z.enum(PAYMENT_METHODS),
    incomeCategoryId: z.uuid(),
    paidOn: z.iso.date().optional(),
    note: optionalText(280),
  })
  .strict()

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>

const SALE_SORTABLE = [
  'saleDate',
  '-saleDate',
  'total',
  '-total',
  'reference',
  '-reference',
] as const

const MAX_RANGE_DAYS = 5 * 366

function withinRange(from?: string, to?: string): boolean {
  if (!from || !to) return true
  if (from > to) return false
  return (Date.parse(to) - Date.parse(from)) / 86_400_000 <= MAX_RANGE_DAYS
}

const RANGE_MESSAGE = 'the range must run forwards and cover no more than five years'

export const listSalesSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    buyerId: z.uuid().optional(),
    warehouseId: z.uuid().optional(),
    status: z.enum(SALE_STATUSES).optional(),
    paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    sort: z.enum(SALE_SORTABLE).default('-saleDate'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine((value) => withinRange(value.from, value.to), { message: RANGE_MESSAGE, path: ['to'] })

export type ListSalesQuery = z.infer<typeof listSalesSchema>

export const salesSummarySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    groupBy: z.enum(['day', 'week', 'month']).default('month'),
  })
  .strict()
  .refine((value) => withinRange(value.from, value.to), { message: RANGE_MESSAGE, path: ['to'] })

export type SalesSummaryQuery = z.infer<typeof salesSummarySchema>
