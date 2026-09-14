import { z } from 'zod'

/**
 * Inventory validators.
 *
 * Quantities are strings on the wire and `numeric(14,3)` in the database, for the same reason
 * money is: 0.1 kilogram cannot be held exactly in a float, and a store record that drifts by a
 * gram per movement is a store record nobody trusts by harvest. Three decimal places, because a
 * cooperative weighs to the gram and sells by the sack.
 *
 * Nothing here is ever a deletion. A movement recorded in error is reversed by an opposite
 * movement that points at it, and the two stay in the history together.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional()

/** Parsed by `lib/money.ts`, never by Zod's number coercion, which would go through a float. */
const decimalString = z.union([z.string().trim().min(1), z.number()])

export const MOVEMENT_TYPES = [
  'RECEIPT',
  'ISSUE',
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'SALE_OUT',
  'SALE_RETURN',
  'OPENING',
] as const

export const DIRECTIONS = ['IN', 'OUT'] as const

export const inventoryIdSchema = z.object({ id: z.uuid() }).strict()

/**
 * Stock arriving. `sourceMemberId` is how a member's delivery is captured: there is no separate
 * deliveries table, so the store record and the member's history can never disagree.
 */
export const receiveSchema = z
  .object({
    productId: z.uuid(),
    warehouseId: z.uuid(),
    quantity: decimalString,
    /** What the cooperative paid per unit, if it paid on receipt. */
    unitCost: decimalString.optional(),
    sourceMemberId: z.uuid().nullable().optional(),
    occurredAt: z.iso.date().optional(),
    note: optionalText(280),
    /**
     * Which expense category to post the cost to. Given only when the cooperative paid on
     * receipt; without it the stock arrives and no money moves, which is what happens when a
     * member delivers produce before the price is agreed.
     */
    expenseCategoryId: z.uuid().optional(),
    /** How the cooperative paid, where it did. */
    method: z.enum(['CASH', 'MOBILE_MONEY', 'BANK', 'CHEQUE', 'OTHER']).optional(),
  })
  .strict()
  .refine((value) => value.expenseCategoryId === undefined || value.unitCost !== undefined, {
    message: 'a receipt that posts an expense has to say what it cost',
    path: ['unitCost'],
  })

export type ReceiveInput = z.infer<typeof receiveSchema>

/** Stock leaving for any reason other than a sale, which is Phase 7. */
export const issueSchema = z
  .object({
    productId: z.uuid(),
    warehouseId: z.uuid(),
    quantity: decimalString,
    occurredAt: z.iso.date().optional(),
    reason: optionalText(280),
    note: optionalText(280),
  })
  .strict()

export type IssueInput = z.infer<typeof issueSchema>

/**
 * A count that disagreed with the record.
 *
 * The input is what was counted, not the difference. A storekeeper counts eight sacks and types
 * eight; working out that the record said ten and the correction is therefore two out is the
 * software's job, and asking a person to do that arithmetic is how the wrong sign gets recorded.
 */
export const adjustSchema = z
  .object({
    productId: z.uuid(),
    warehouseId: z.uuid(),
    countedQuantity: decimalString,
    /** Required. An unexplained correction is what makes a shortfall unauditable. */
    reason: z.string().trim().min(1).max(280),
    occurredAt: z.iso.date().optional(),
    note: optionalText(280),
  })
  .strict()

export type AdjustInput = z.infer<typeof adjustSchema>

export const transferSchema = z
  .object({
    productId: z.uuid(),
    fromWarehouseId: z.uuid(),
    toWarehouseId: z.uuid(),
    quantity: decimalString,
    occurredAt: z.iso.date().optional(),
    note: optionalText(280),
  })
  .strict()
  .refine((value) => value.fromWarehouseId !== value.toWarehouseId, {
    message: 'a transfer needs two different stores',
    path: ['toWarehouseId'],
  })

export type TransferInput = z.infer<typeof transferSchema>

export const reverseSchema = z
  .object({
    /** Required, because a reversal is itself a correction somebody has to account for. */
    reason: z.string().trim().min(1).max(280),
  })
  .strict()

const MOVEMENT_SORTABLE = ['occurredAt', '-occurredAt', 'reference', '-reference'] as const

/** Five years, matching the finance ledger, so a report can never ask for an unbounded scan. */
const MAX_RANGE_DAYS = 5 * 366

function withinRange(from?: string, to?: string): boolean {
  if (!from || !to) return true
  if (from > to) return false
  return (Date.parse(to) - Date.parse(from)) / 86_400_000 <= MAX_RANGE_DAYS
}

const RANGE_MESSAGE = 'the range must run forwards and cover no more than five years'

export const listMovementsSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    productId: z.uuid().optional(),
    warehouseId: z.uuid().optional(),
    memberId: z.uuid().optional(),
    type: z.enum(MOVEMENT_TYPES).optional(),
    direction: z.enum(DIRECTIONS).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    sort: z.enum(MOVEMENT_SORTABLE).default('-occurredAt'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine((value) => withinRange(value.from, value.to), { message: RANGE_MESSAGE, path: ['to'] })

export type ListMovementsQuery = z.infer<typeof listMovementsSchema>

export const listStockSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    warehouseId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    /** Only what is at or below its minimum, which is the question the overview leads with. */
    lowOnly: z.enum(['true', 'false']).default('false'),
    /** Hide the rows sitting at nothing, which is most of a long catalogue. */
    inStockOnly: z.enum(['true', 'false']).default('false'),
    sort: z.enum(['product', '-product', 'quantity', '-quantity']).default('product'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()

export type ListStockQuery = z.infer<typeof listStockSchema>
