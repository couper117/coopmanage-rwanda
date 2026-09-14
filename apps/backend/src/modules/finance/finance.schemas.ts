import { z } from 'zod'

/**
 * Finance validators.
 *
 * Two rules from the product brief shape all of this.
 *
 * **Amounts are strings here and decimals in the database, never floats.** Zod checks the shape of
 * a value; `lib/money.ts` checks the value itself. `z.number()` would put the amount through a
 * JavaScript float on the way in and undo the point of the decimal column, so it is never used for
 * money.
 *
 * **Once posted, the amount, the kind and the date of an entry can never be edited.** Only the
 * description and the category can change, and only while the entry is still `POSTED`. A wrong
 * figure is corrected by voiding it, which writes a reversal, so both the mistake and its
 * correction stay in the history. That is what makes a cooperative's books defensible a year
 * later, and it is why the patch schema below is as small as it is.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional()

/** Accepts a decimal string, or a number for a client that could not help itself. */
const amountString = z.union([z.string().trim().min(1), z.number()])

export const FINANCE_KINDS = ['INCOME', 'EXPENSE'] as const
export const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK', 'CHEQUE', 'OTHER'] as const
export const FINANCE_STATUSES = ['POSTED', 'VOID'] as const

export const financeIdSchema = z.object({ id: z.uuid() }).strict()

export const createTransactionSchema = z
  .object({
    kind: z.enum(FINANCE_KINDS),
    categoryId: z.uuid(),
    amount: amountString,
    /** Defaults to today. The date the money moved, which is not always the date it was typed. */
    occurredAt: z.iso.date().optional(),
    method: z.enum(PAYMENT_METHODS),
    /**
     * The one free-text field, and it is where a paper receipt number goes: there is no separate
     * column for one, and inventing a table this phase was not meant to create would be worse
     * than a description that reads "Receipt 04521, transport to Kigali".
     */
    description: z.string().trim().min(1).max(280),
    memberId: z.uuid().nullable().optional(),
  })
  .strict()

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>

/**
 * The only two fields a posted entry can still change: which category it belongs to, and how it is
 * described. Neither alters what the books say the cooperative has.
 */
export const updateTransactionSchema = z
  .object({
    categoryId: z.uuid().optional(),
    description: z.string().trim().min(1).max(280).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  })

export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>

export const voidTransactionSchema = z.object({ reason: optionalText(280) }).strict()

const SORTABLE = [
  'occurredAt',
  '-occurredAt',
  'amount',
  '-amount',
  'reference',
  '-reference',
] as const

/** Five years, which is longer than any report a cooperative runs and short enough to stay fast. */
const MAX_RANGE_DAYS = 5 * 366

function withinRange(from?: string, to?: string): boolean {
  if (!from || !to) return true
  if (from > to) return false
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000
  return days <= MAX_RANGE_DAYS
}

const RANGE_MESSAGE = 'the range must run forwards and cover no more than five years'

export const listTransactionsSchema = z
  .object({
    /** Free text over the reference and the description. */
    q: z.string().trim().max(120).optional(),
    kind: z.enum(FINANCE_KINDS).optional(),
    categoryId: z.uuid().optional(),
    memberId: z.uuid().optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    status: z.enum(FINANCE_STATUSES).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    minAmount: amountString.optional(),
    maxAmount: amountString.optional(),
    sort: z.enum(SORTABLE).default('-occurredAt'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine((value) => withinRange(value.from, value.to), { message: RANGE_MESSAGE, path: ['to'] })

export type ListTransactionsQuery = z.infer<typeof listTransactionsSchema>

/** Declared from the same shape rather than derived, because a refined object cannot be narrowed. */
export const exportTransactionsSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    kind: z.enum(FINANCE_KINDS).optional(),
    categoryId: z.uuid().optional(),
    memberId: z.uuid().optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    status: z.enum(FINANCE_STATUSES).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    minAmount: amountString.optional(),
    maxAmount: amountString.optional(),
    sort: z.enum(SORTABLE).default('-occurredAt'),
    /** `csv` opens anywhere; `xlsx` is what an accountant asked for. */
    format: z.enum(['csv', 'xlsx']).default('csv'),
  })
  .strict()
  .refine((value) => withinRange(value.from, value.to), { message: RANGE_MESSAGE, path: ['to'] })

export type ExportTransactionsQuery = z.infer<typeof exportTransactionsSchema>

export const GROUP_BY = ['day', 'week', 'month'] as const

/**
 * The summary takes a range and a grouping. Both dates are required: a summary with no range is a
 * question nobody asks, and defaulting it would quietly report a different period than the one the
 * reader has in mind.
 */
export const summarySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    groupBy: z.enum(GROUP_BY).default('month'),
    categoryId: z.uuid().optional(),
  })
  .strict()
  .refine((value) => withinRange(value.from, value.to), { message: RANGE_MESSAGE, path: ['to'] })

export type SummaryQuery = z.infer<typeof summarySchema>

export const trendsSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    groupBy: z.enum(GROUP_BY).default('month'),
  })
  .strict()
  .refine((value) => withinRange(value.from, value.to), { message: RANGE_MESSAGE, path: ['to'] })

export type TrendsQuery = z.infer<typeof trendsSchema>

export const listCategoriesSchema = z
  .object({
    kind: z.enum(FINANCE_KINDS).optional(),
    /** Defaults to the active ones, because that is what a form needs. */
    includeInactive: z.enum(['true', 'false']).default('false'),
  })
  .strict()

export type ListCategoriesQuery = z.infer<typeof listCategoriesSchema>

export const createCategorySchema = z
  .object({
    kind: z.enum(FINANCE_KINDS),
    name: z.string().trim().min(1).max(80),
    /** The Kinyarwanda name, optional: a cooperative may work in one language only. */
    nameRw: optionalText(80),
    /** A short code, for a cooperative that already numbers its categories on paper. */
    code: optionalText(20),
  })
  .strict()

export type CreateCategoryInput = z.infer<typeof createCategorySchema>

/**
 * A category's kind is fixed once it exists. Moving a category from income to expense would flip
 * the sign of every entry already posted against it, silently rewriting past months.
 */
export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    nameRw: optionalText(80),
    code: optionalText(20),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  })

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>
