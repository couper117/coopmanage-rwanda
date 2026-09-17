import writeXlsxFile, { type SheetData } from 'write-excel-file/node'
import { Prisma } from '@prisma/client'
import type { FinanceKind, FinanceSourceType, PaymentMethod } from '@prisma/client'
import { auditWithin, writeAudit } from '../../lib/audit.js'
import type { RequestContext } from '../../lib/context.js'
import { csvCell } from '../../lib/csv.js'
import { isUniqueViolation } from '../../lib/dbErrors.js'
import { AppError } from '../../lib/errors.js'
import { financePrefixFor, nextFinanceReference, type Db } from '../../lib/references.js'
import {
  add,
  compare,
  fromDatabase,
  MONEY_SCALE,
  multiply,
  parseMoney,
  round,
  subtract,
  toMoney,
  toWire,
  ZERO,
  type Money,
} from '../../lib/money.js'
import { prisma } from '../../lib/prisma.js'
import type {
  CreateCategoryInput,
  ExportTransactionsQuery,
  CreateTransactionInput,
  ListCategoriesQuery,
  ListTransactionsQuery,
  SummaryQuery,
  TrendsQuery,
  UpdateCategoryInput,
  UpdateTransactionInput,
} from './finance.schemas.js'

/**
 * Posting into the ledger.
 *
 * Phase 4 needs this because a contribution and a share purchase each create their linked income
 * row in the same database transaction that creates them. The finance *module* — categories,
 * summaries, void and reversal, the screens — is Phase 5; what lives here is the one function
 * everything else posts through, so there is exactly one place a monetary row is written.
 */

/** The resolved cooperative, or a refusal. Every query in this module is scoped by it. */
function requireCooperativeId(ctx: RequestContext): string {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw AppError.noCooperativeAccess()
  return cooperativeId
}

/**
 * What counts towards a figure the cooperative is shown.
 *
 * A voided entry and the reversal written to correct it are two rows that cancel each other, so a
 * total has to take both or neither. Taking the reversal while excluding the void applies the
 * correction twice, which is how voiding 77,777.77 francs once took 155,555.54 off the balance in
 * an early version of this module. Excluding the pair is the clearer of the two, because it also
 * keeps "money in this month" honest: a receipt that was cancelled is not money the cooperative
 * received, so it should not appear in the month's income either.
 *
 * Both rows stay in the ledger listing with their status, which is what makes the correction
 * visible. This only governs arithmetic.
 */
export const COUNTS_TOWARDS_TOTALS = {
  status: 'POSTED',
  reversalOfId: null,
} as const satisfies Prisma.FinanceTransactionWhereInput

export interface PostTransactionInput {
  kind: FinanceKind
  categoryId: string
  /** Already parsed and validated by `lib/money.ts`. Never a JavaScript number. */
  amount: Money
  occurredAt: Date
  method: PaymentMethod
  description: string
  sourceType: FinanceSourceType
  memberId?: string | null
}

export interface PostedTransaction {
  id: string
  reference: string
  kind: FinanceKind
  amount: string
}

/**
 * Writes one ledger row inside the caller's transaction.
 *
 * Takes a transaction client rather than opening its own, which is the whole point: a contribution
 * and its income row either both exist or neither does. A caller that posted through the base
 * client would leave the two able to disagree.
 */
export async function postTransaction(
  db: Db,
  ctx: RequestContext,
  input: PostTransactionInput,
): Promise<PostedTransaction> {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw AppError.noCooperativeAccess()

  const category = await db.financeCategory.findFirst({
    where: { id: input.categoryId, cooperativeId, kind: input.kind, isActive: true },
    // The Kinyarwanda name comes along so the audit entry can record both — see `AuditInput`.
    select: { id: true, name: true, nameRw: true },
  })
  if (!category) {
    throw AppError.validationFailed([
      { field: 'body.categoryId', messageKey: 'validation.invalid_value' },
    ])
  }

  const reference = await nextFinanceReference(
    db,
    cooperativeId,
    financePrefixFor(input.kind),
    input.occurredAt,
  )

  const row = await db.financeTransaction.create({
    data: {
      cooperativeId,
      reference,
      kind: input.kind,
      categoryId: category.id,
      amount: input.amount,
      occurredAt: input.occurredAt,
      method: input.method,
      description: input.description,
      sourceType: input.sourceType,
      memberId: input.memberId ?? null,
      createdById: ctx.user.id,
    },
    select: { id: true, reference: true, kind: true, amount: true },
  })

  await auditWithin(
    db,
    { ctx },
    {
      action: 'finance.transaction.posted',
      entityType: 'FinanceTransaction',
      entityId: row.id,
      messageKey: 'audit.finance.posted',
      messageParams: {
        reference: row.reference,
        amount: toWire(row.amount),
        category: category.name,
        categoryRw: category.nameRw ?? category.name,
      },
      after: {
        reference: row.reference,
        kind: row.kind,
        amount: toWire(row.amount),
        category: category.name,
        sourceType: input.sourceType,
      },
    },
  )

  return { id: row.id, reference: row.reference, kind: row.kind, amount: toWire(row.amount) }
}

/**
 * Voids a posted row by writing a reversal of the opposite kind and marking the original.
 *
 * Nothing is ever deleted or edited. Both rows stay in the history, so a cooperative can see that
 * a mistake was made and corrected rather than finding a figure that silently changed. This is
 * what `docs/architecture.md` section 7 means by reversal rather than deletion, and it is the
 * reason the balance can be recomputed from the ledger at any time.
 */
export async function voidTransaction(
  db: Db,
  ctx: RequestContext,
  transactionId: string,
  reason: string | null,
): Promise<{ voided: PostedTransaction; reversal: PostedTransaction }> {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw AppError.noCooperativeAccess()

  const original = await db.financeTransaction.findFirst({
    where: { id: transactionId, cooperativeId },
    select: {
      id: true,
      reference: true,
      kind: true,
      categoryId: true,
      amount: true,
      occurredAt: true,
      method: true,
      description: true,
      sourceType: true,
      memberId: true,
      status: true,
    },
  })
  if (!original) throw AppError.notFound()
  if (original.status === 'VOID') {
    throw AppError.conflict(
      'errors.finance.alreadyVoid',
      'That transaction has already been voided.',
    )
  }

  const oppositeKind: FinanceKind = original.kind === 'INCOME' ? 'EXPENSE' : 'INCOME'
  const reference = await nextFinanceReference(
    db,
    cooperativeId,
    financePrefixFor(oppositeKind),
    original.occurredAt,
  )

  const reversal = await db.financeTransaction.create({
    data: {
      cooperativeId,
      reference,
      kind: oppositeKind,
      categoryId: original.categoryId,
      amount: original.amount,
      // The reversal takes the original's accounting date, so a correction does not move money
      // between periods that have already been reported on.
      occurredAt: original.occurredAt,
      method: original.method,
      description: `Reversal of ${original.reference}: ${original.description}`,
      sourceType: original.sourceType,
      memberId: original.memberId,
      reversalOfId: original.id,
      createdById: ctx.user.id,
    },
    select: { id: true, reference: true, kind: true, amount: true },
  })

  await db.financeTransaction.update({
    where: { id: original.id },
    data: {
      status: 'VOID',
      voidReason: reason,
      voidedById: ctx.user.id,
      voidedAt: new Date(),
    },
  })

  await auditWithin(
    db,
    { ctx },
    {
      action: 'finance.transaction.voided',
      entityType: 'FinanceTransaction',
      entityId: original.id,
      messageKey: 'audit.finance.voided',
      messageParams: { reference: original.reference, reversal: reversal.reference },
      before: { status: 'POSTED', reference: original.reference },
      after: { status: 'VOID', reversal: reversal.reference, reason },
    },
  )

  return {
    voided: {
      id: original.id,
      reference: original.reference,
      kind: original.kind,
      amount: toWire(original.amount),
    },
    reversal: {
      id: reversal.id,
      reference: reversal.reference,
      kind: reversal.kind,
      amount: toWire(reversal.amount),
    },
  }
}

/**
 * The cooperative's balance, and the two figures it is made of.
 *
 * One definition, used by the finance screen, the member profile, the reports and the dashboard,
 * so they cannot disagree about what the cooperative has. Summed in the database, over POSTED
 * rows only: a voided row and its reversal cancel out, and excluding the void while counting the
 * reversal would double the correction.
 */
export interface FinanceTotals {
  income: string
  expenses: string
  balance: string
}

export async function financeTotals(
  cooperativeId: string,
  filters: { from?: Date; to?: Date; memberId?: string } = {},
): Promise<FinanceTotals> {
  const where: Prisma.FinanceTransactionWhereInput = {
    cooperativeId,
    ...COUNTS_TOWARDS_TOTALS,
    ...(filters.memberId ? { memberId: filters.memberId } : {}),
    ...(filters.from || filters.to
      ? {
          occurredAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  }

  const grouped = await prisma.financeTransaction.groupBy({
    by: ['kind'],
    where,
    _sum: { amount: true },
  })

  const income = grouped.find((row) => row.kind === 'INCOME')?._sum.amount ?? null
  const expenses = grouped.find((row) => row.kind === 'EXPENSE')?._sum.amount ?? null

  // `groupBy` returns no row for a kind with no transactions, which is not the same as zero.
  const incomeTotal = income === null ? ZERO : toMoney(income)
  const expenseTotal = expenses === null ? ZERO : toMoney(expenses)

  return {
    income: toWire(incomeTotal),
    expenses: toWire(expenseTotal),
    balance: toWire(subtract(incomeTotal, expenseTotal)),
  }
}

// ---------------------------------------------------------------------------
// Phase 5: the finance module proper — the ledger, the summaries and the
// categories, all on the tables M4 had to create.
// ---------------------------------------------------------------------------

export interface TransactionRow {
  id: string
  reference: string
  kind: FinanceKind
  categoryId: string
  categoryName: string
  categoryNameRw: string | null
  amount: string
  occurredAt: string
  method: PaymentMethod
  description: string
  memberId: string | null
  memberName: string | null
  memberCode: string | null
  status: string
  sourceType: FinanceSourceType
  /** Set when this entry is itself a correction, naming the entry it corrects. */
  reversalOfReference: string | null
  /** Set when this entry has been corrected, naming the correction. */
  reversedByReference: string | null
}

export interface TransactionDetail extends TransactionRow {
  voidReason: string | null
  voidedAt: string | null
  createdAt: string
}

const ROW_SELECT = {
  id: true,
  reference: true,
  kind: true,
  categoryId: true,
  amount: true,
  occurredAt: true,
  method: true,
  description: true,
  memberId: true,
  status: true,
  sourceType: true,
  category: { select: { name: true, nameRw: true } },
  member: { select: { memberCode: true, firstName: true, lastName: true } },
  reversalOf: { select: { reference: true } },
  reversedBy: { select: { reference: true } },
} as const

type LedgerRow = Prisma.FinanceTransactionGetPayload<{ select: typeof ROW_SELECT }>

function toRow(row: LedgerRow): TransactionRow {
  return {
    id: row.id,
    reference: row.reference,
    kind: row.kind,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    categoryNameRw: row.category.nameRw,
    amount: toWire(row.amount),
    occurredAt: row.occurredAt.toISOString().slice(0, 10),
    method: row.method,
    description: row.description,
    memberId: row.memberId,
    memberName: row.member ? `${row.member.firstName} ${row.member.lastName}` : null,
    memberCode: row.member?.memberCode ?? null,
    status: row.status,
    sourceType: row.sourceType,
    reversalOfReference: row.reversalOf?.reference ?? null,
    reversedByReference: row.reversedBy?.reference ?? null,
  }
}

function buildLedgerWhere(
  cooperativeId: string,
  filters: Omit<ListTransactionsQuery, 'page' | 'pageSize' | 'sort'>,
): Prisma.FinanceTransactionWhereInput {
  const search = filters.q?.trim()
  const min = filters.minAmount === undefined ? undefined : toMoney(filters.minAmount)
  const max = filters.maxAmount === undefined ? undefined : toMoney(filters.maxAmount)

  return {
    cooperativeId,
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.memberId ? { memberId: filters.memberId } : {}),
    ...(filters.method ? { method: filters.method } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.from || filters.to
      ? {
          occurredAt: {
            ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00.000Z`) } : {}),
            ...(filters.to ? { lte: new Date(`${filters.to}T00:00:00.000Z`) } : {}),
          },
        }
      : {}),
    ...(min !== undefined || max !== undefined
      ? {
          amount: {
            ...(min !== undefined ? { gte: min } : {}),
            ...(max !== undefined ? { lte: max } : {}),
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { reference: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
}

function buildLedgerOrder(
  sort: ListTransactionsQuery['sort'],
): Prisma.FinanceTransactionOrderByWithRelationInput[] {
  switch (sort) {
    case 'occurredAt':
      return [{ occurredAt: 'asc' }, { reference: 'asc' }]
    case 'amount':
      return [{ amount: 'asc' }]
    case '-amount':
      return [{ amount: 'desc' }]
    case 'reference':
      return [{ reference: 'asc' }]
    case '-reference':
      return [{ reference: 'desc' }]
    default:
      return [{ occurredAt: 'desc' }, { reference: 'desc' }]
  }
}

/**
 * The ledger.
 *
 * The totals returned alongside the page cover the whole filtered set, not the rows on screen.
 * When a treasurer narrows the list to one category and one month, the figure they are after is
 * the total of that, and a footer that summed twenty-five rows out of two hundred would be a
 * wrong answer rather than a partial one.
 */
export async function listTransactions(
  ctx: RequestContext,
  query: ListTransactionsQuery,
): Promise<{ items: TransactionRow[]; total: number; totals: FinanceTotals }> {
  const cooperativeId = requireCooperativeId(ctx)
  const { page, pageSize, sort, ...filters } = query
  const where = buildLedgerWhere(cooperativeId, filters)

  const [rows, total, income, expense] = await Promise.all([
    prisma.financeTransaction.findMany({
      where,
      select: ROW_SELECT,
      orderBy: buildLedgerOrder(sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.financeTransaction.count({ where }),
    // Only POSTED rows count towards a total. A voided row and its reversal cancel each other, so
    // counting the reversal while excluding the void would apply the correction twice.
    // Combined with AND rather than merged, so the caller's own filters are not quietly
    // overridden. Merging meant a list filtered to voided entries showed the totals of the
    // posted ones instead: a big number in the footer under rows that add up to nothing.
    prisma.financeTransaction.aggregate({
      where: { AND: [where, { kind: 'INCOME' }, COUNTS_TOWARDS_TOTALS] },
      _sum: { amount: true },
    }),
    prisma.financeTransaction.aggregate({
      where: { AND: [where, { kind: 'EXPENSE' }, COUNTS_TOWARDS_TOTALS] },
      _sum: { amount: true },
    }),
  ])

  const incomeTotal = income._sum.amount ?? ZERO
  const expenseTotal = expense._sum.amount ?? ZERO

  return {
    items: rows.map(toRow),
    total,
    totals: {
      income: toWire(incomeTotal),
      expenses: toWire(expenseTotal),
      balance: toWire(subtract(incomeTotal, expenseTotal)),
    },
  }
}

export async function getTransaction(ctx: RequestContext, id: string): Promise<TransactionDetail> {
  const cooperativeId = requireCooperativeId(ctx)
  const row = await prisma.financeTransaction.findFirst({
    where: { id, cooperativeId },
    select: { ...ROW_SELECT, voidReason: true, voidedAt: true, createdAt: true },
  })
  if (!row) throw AppError.notFound()

  return {
    ...toRow(row),
    voidReason: row.voidReason,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Records one entry in the cooperative's books.
 *
 * The amount is parsed by `lib/money.ts`, which refuses anything with more decimal places than the
 * column holds rather than rounding it: the figure stored has to be the figure typed. A member may
 * be named, which is what links a payment to the person who received it.
 */
export async function createTransaction(
  ctx: RequestContext,
  input: CreateTransactionInput,
): Promise<TransactionDetail> {
  const cooperativeId = requireCooperativeId(ctx)
  const amount = parseMoney(input.amount, { field: 'body.amount' })
  const occurredAt = input.occurredAt
    ? new Date(`${input.occurredAt}T00:00:00.000Z`)
    : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z')

  if (input.memberId) {
    const member = await prisma.member.findFirst({
      where: { id: input.memberId, cooperativeId },
      select: { id: true },
    })
    if (!member) {
      throw AppError.validationFailed([
        { field: 'body.memberId', messageKey: 'validation.invalid_value' },
      ])
    }
  }

  const posted = await prisma.$transaction((tx) =>
    postTransaction(tx, ctx, {
      kind: input.kind,
      categoryId: input.categoryId,
      amount,
      occurredAt,
      method: input.method,
      description: input.description,
      sourceType: 'MANUAL',
      memberId: input.memberId ?? null,
    }),
  )

  return getTransaction(ctx, posted.id)
}

/**
 * Changes the two things about a posted entry that do not alter what the books say: its category
 * and its description. The amount, the kind and the date are fixed for good; a wrong figure is
 * voided and re-entered so both rows stay in the history.
 */
export async function updateTransaction(
  ctx: RequestContext,
  id: string,
  input: UpdateTransactionInput,
): Promise<TransactionDetail> {
  const cooperativeId = requireCooperativeId(ctx)
  const before = await prisma.financeTransaction.findFirst({
    where: { id, cooperativeId },
    select: {
      id: true,
      kind: true,
      status: true,
      categoryId: true,
      description: true,
      reference: true,
    },
  })
  if (!before) throw AppError.notFound()
  if (before.status !== 'POSTED') {
    throw AppError.conflict(
      'errors.finance.voidedNotEditable',
      'A voided entry cannot be changed. It stays as it is, beside its correction.',
    )
  }

  if (input.categoryId && input.categoryId !== before.categoryId) {
    // The new category has to be of the same kind, or the entry would change which side of the
    // balance it falls on without its amount ever being touched.
    const category = await prisma.financeCategory.findFirst({
      where: { id: input.categoryId, cooperativeId, kind: before.kind, isActive: true },
      select: { id: true },
    })
    if (!category) {
      throw AppError.validationFailed([
        { field: 'body.categoryId', messageKey: 'validation.invalid_value' },
      ])
    }
  }

  await prisma.financeTransaction.update({
    where: { id },
    data: {
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.description ? { description: input.description } : {}),
    },
  })

  await writeAudit(
    { ctx },
    {
      action: 'finance.transaction.updated',
      entityType: 'FinanceTransaction',
      entityId: id,
      messageKey: 'audit.finance.updated',
      messageParams: { reference: before.reference },
      before: { categoryId: before.categoryId, description: before.description },
      after: {
        categoryId: input.categoryId ?? before.categoryId,
        description: input.description ?? before.description,
      },
    },
  )

  return getTransaction(ctx, id)
}

/** Voids an entry by reference to its identifier, opening the transaction the reversal needs. */
export async function voidTransactionById(
  ctx: RequestContext,
  id: string,
  reason: string | null,
): Promise<{ voided: PostedTransaction; reversal: PostedTransaction }> {
  const cooperativeId = requireCooperativeId(ctx)
  const exists = await prisma.financeTransaction.findFirst({
    where: { id, cooperativeId },
    select: { id: true, sourceType: true },
  })
  if (!exists) throw AppError.notFound()

  if (
    exists.sourceType === 'CONTRIBUTION' ||
    exists.sourceType === 'SHARE_PURCHASE' ||
    exists.sourceType === 'SALE' ||
    exists.sourceType === 'STOCK_PURCHASE'
  ) {
    // The ledger row and the record it came from are two views of the same money. Voiding only
    // the ledger side would leave a member's history claiming money the books no longer hold, or
    // a sale showing a payment that has been reversed, so the correction has to be made where the
    // money was recorded: cancel the contribution, the sale, or the stock receipt.
    throw AppError.conflict(
      'errors.finance.voidFromSource',
      'This entry came from a member record, a sale or a stock receipt. Cancel it there, so both views stay in step.',
    )
  }

  return prisma.$transaction((tx) => voidTransaction(tx, ctx, id, reason))
}

export interface SummaryBucket {
  /** The first day the bucket covers, as a plain date. */
  start: string
  income: string
  expenses: string
  net: string
}

export interface CategoryBreakdownRow {
  categoryId: string
  name: string
  nameRw: string | null
  kind: FinanceKind
  total: string
  /** Percentage of that kind's total, to one decimal place, so a chart needs no arithmetic. */
  share: string
}

export interface FinanceSummary {
  from: string
  to: string
  groupBy: 'day' | 'week' | 'month'
  /** What the cooperative held the day before the range began. */
  opening: string
  income: string
  expenses: string
  net: string
  closing: string
  buckets: SummaryBucket[]
  categories: CategoryBreakdownRow[]
}

function startOfDay(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

/**
 * What the cooperative held before the range began.
 *
 * Summed over every POSTED row with an earlier date, because a balance is not a stored number
 * anywhere in this system: it is the ledger added up. That is the whole reason a correction is a
 * reversal rather than an edit — the sum can be recomputed at any time and still agree with the
 * history.
 */
async function openingBalance(cooperativeId: string, from: string): Promise<Money> {
  const before = startOfDay(from)
  const [income, expenses] = await Promise.all([
    prisma.financeTransaction.aggregate({
      where: {
        cooperativeId,
        kind: 'INCOME',
        occurredAt: { lt: before },
        ...COUNTS_TOWARDS_TOTALS,
      },
      _sum: { amount: true },
    }),
    prisma.financeTransaction.aggregate({
      where: {
        cooperativeId,
        kind: 'EXPENSE',
        occurredAt: { lt: before },
        ...COUNTS_TOWARDS_TOTALS,
      },
      _sum: { amount: true },
    }),
  ])
  return subtract(income._sum.amount ?? ZERO, expenses._sum.amount ?? ZERO)
}

/**
 * Money in, money out and the balance, over a range, grouped by day, week or month.
 *
 * The grouping is done by PostgreSQL rather than in JavaScript, so a year of daily entries is one
 * query and the sums stay in `numeric` the whole way. A week starts on Monday, which is what
 * `date_trunc` does and what a Rwandan working week does.
 *
 * Buckets with no entries are filled in as zero rather than omitted. A chart that skips an empty
 * month draws a line between two points that are not adjacent, which reads as a trend that did
 * not happen.
 */
export async function financeSummary(
  ctx: RequestContext,
  query: SummaryQuery,
): Promise<FinanceSummary> {
  const cooperativeId = requireCooperativeId(ctx)
  const from = startOfDay(query.from)
  const to = startOfDay(query.to)

  const categoryFilter = query.categoryId
    ? Prisma.sql`AND category_id = ${query.categoryId}::uuid`
    : Prisma.empty

  const rows = await prisma.$queryRaw<{ bucket: Date; kind: string; total: unknown }[]>`
    SELECT date_trunc(${query.groupBy}, occurred_at) AS bucket,
           kind,
           sum(amount) AS total
      FROM finance_transactions
     WHERE cooperative_id = ${cooperativeId}::uuid
       AND status = 'POSTED'
       AND reversal_of_id IS NULL
       AND occurred_at >= ${from}
       AND occurred_at <= ${to}
       ${categoryFilter}
     GROUP BY 1, 2
     ORDER BY 1
  `

  const byBucket = new Map<string, { income: Money; expenses: Money }>()
  for (const row of rows) {
    const key = row.bucket.toISOString().slice(0, 10)
    const entry = byBucket.get(key) ?? { income: ZERO, expenses: ZERO }
    if (row.kind === 'INCOME') entry.income = fromDatabase(row.total)
    else entry.expenses = fromDatabase(row.total)
    byBucket.set(key, entry)
  }

  const buckets: SummaryBucket[] = []
  let income = ZERO
  let expenses = ZERO
  for (const start of bucketStarts(query.from, query.to, query.groupBy)) {
    const entry = byBucket.get(start) ?? { income: ZERO, expenses: ZERO }
    income = add(income, entry.income)
    expenses = add(expenses, entry.expenses)
    buckets.push({
      start,
      income: toWire(entry.income),
      expenses: toWire(entry.expenses),
      net: toWire(subtract(entry.income, entry.expenses)),
    })
  }

  const opening = await openingBalance(cooperativeId, query.from)
  const net = subtract(income, expenses)

  return {
    from: query.from,
    to: query.to,
    groupBy: query.groupBy,
    opening: toWire(opening),
    income: toWire(income),
    expenses: toWire(expenses),
    net: toWire(net),
    closing: toWire(add(opening, net)),
    buckets,
    categories: await categoryBreakdown(cooperativeId, from, to, query.categoryId),
  }
}

/**
 * Every bucket start in the range, in order, including the ones with nothing in them.
 *
 * Built by walking UTC dates rather than by adding milliseconds, so a month is a month whatever
 * its length and no daylight saving anywhere can shift a boundary.
 */
export function bucketStarts(
  from: string,
  to: string,
  groupBy: 'day' | 'week' | 'month',
): string[] {
  const end = startOfDay(to)
  const starts: string[] = []
  let cursor = truncate(startOfDay(from), groupBy)

  while (cursor <= end) {
    starts.push(cursor.toISOString().slice(0, 10))
    cursor = advance(cursor, groupBy)
    if (starts.length > 2000) break
  }
  return starts
}

/** Matches PostgreSQL's `date_trunc`, including a week that begins on Monday. */
function truncate(date: Date, groupBy: 'day' | 'week' | 'month'): Date {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  if (groupBy === 'month') return new Date(Date.UTC(year, month, 1))
  if (groupBy === 'day') return new Date(Date.UTC(year, month, day))
  // Sunday is 0 in JavaScript and the last day of the week in ISO, so it moves back six days.
  const weekday = date.getUTCDay()
  const back = weekday === 0 ? 6 : weekday - 1
  return new Date(Date.UTC(year, month, day - back))
}

function advance(date: Date, groupBy: 'day' | 'week' | 'month'): Date {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  if (groupBy === 'month') return new Date(Date.UTC(year, month + 1, 1))
  return new Date(Date.UTC(year, month, day + (groupBy === 'week' ? 7 : 1)))
}

/**
 * Where the money went, by category, as a figure and as a share of its own kind.
 *
 * The share is computed against income or expenses separately, never against the two combined: a
 * category that is 40 % of what the cooperative spent is a useful sentence, while 40 % of
 * everything that moved is not.
 */
async function categoryBreakdown(
  cooperativeId: string,
  from: Date,
  to: Date,
  categoryId?: string,
): Promise<CategoryBreakdownRow[]> {
  const grouped = await prisma.financeTransaction.groupBy({
    by: ['categoryId', 'kind'],
    where: {
      cooperativeId,
      occurredAt: { gte: from, lte: to },
      ...(categoryId ? { categoryId } : {}),
      ...COUNTS_TOWARDS_TOTALS,
    },
    _sum: { amount: true },
  })
  if (grouped.length === 0) return []

  const categories = await prisma.financeCategory.findMany({
    where: { id: { in: grouped.map((row) => row.categoryId) } },
    select: { id: true, name: true, nameRw: true },
  })
  const named = new Map(categories.map((row) => [row.id, row]))

  const kindTotals = new Map<string, Money>()
  for (const row of grouped) {
    kindTotals.set(row.kind, add(kindTotals.get(row.kind) ?? ZERO, row._sum.amount ?? ZERO))
  }

  return grouped
    .map((row) => {
      const total = row._sum.amount ?? ZERO
      const kindTotal = kindTotals.get(row.kind) ?? ZERO
      const category = named.get(row.categoryId)
      return {
        categoryId: row.categoryId,
        name: category?.name ?? 'Unknown',
        nameRw: category?.nameRw ?? null,
        kind: row.kind,
        total: toWire(total),
        share: kindTotal.isZero()
          ? '0.0'
          : round(multiply(total, 100).div(kindTotal), 1).toFixed(1),
      }
    })
    .sort((a, b) => compare(b.total, a.total) || a.name.localeCompare(b.name))
}

export interface TrendPoint {
  start: string
  income: string
  expenses: string
  net: string
  /** The balance at the end of this bucket, carried forward from the opening balance. */
  balance: string
}

/**
 * The same figures as the summary, carried forward into a running balance.
 *
 * Separate from the summary because it answers a different question: not "what happened in
 * March" but "is the cooperative better off than it was in January".
 */
export async function financeTrends(
  ctx: RequestContext,
  query: TrendsQuery,
): Promise<{ groupBy: string; opening: string; points: TrendPoint[] }> {
  const summary = await financeSummary(ctx, { ...query, groupBy: query.groupBy })
  let balance = toMoney(summary.opening)

  const points = summary.buckets.map((bucket) => {
    balance = add(balance, subtract(bucket.income, bucket.expenses))
    return {
      start: bucket.start,
      income: bucket.income,
      expenses: bucket.expenses,
      net: bucket.net,
      balance: toWire(balance),
    }
  })

  return { groupBy: query.groupBy, opening: summary.opening, points }
}

export interface CategoryRow {
  id: string
  kind: FinanceKind
  name: string
  nameRw: string | null
  code: string | null
  isActive: boolean
  /** A category the system created. It can be renamed and deactivated, but never removed. */
  isSystem: boolean
  /** How many entries are posted against it, so the interface can warn before deactivating. */
  entryCount: number
  total: string
}

export async function listCategories(
  ctx: RequestContext,
  query: ListCategoriesQuery,
): Promise<CategoryRow[]> {
  const cooperativeId = requireCooperativeId(ctx)
  const categories = await prisma.financeCategory.findMany({
    where: {
      cooperativeId,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.includeInactive === 'true' ? {} : { isActive: true }),
    },
    select: {
      id: true,
      kind: true,
      name: true,
      nameRw: true,
      code: true,
      isActive: true,
      isSystem: true,
    },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
  })
  if (categories.length === 0) return []

  const grouped = await prisma.financeTransaction.groupBy({
    by: ['categoryId'],
    where: {
      cooperativeId,
      categoryId: { in: categories.map((row) => row.id) },
      ...COUNTS_TOWARDS_TOTALS,
    },
    _sum: { amount: true },
    _count: { _all: true },
  })
  const usage = new Map(grouped.map((row) => [row.categoryId, row]))

  return categories.map((row) => {
    const used = usage.get(row.id)
    return {
      ...row,
      entryCount: used?._count._all ?? 0,
      total: toWire(used?._sum.amount ?? ZERO),
    }
  })
}

export async function createCategory(
  ctx: RequestContext,
  input: CreateCategoryInput,
): Promise<CategoryRow> {
  const cooperativeId = requireCooperativeId(ctx)

  const created = await prisma.financeCategory
    .create({
      data: {
        cooperativeId,
        kind: input.kind,
        name: input.name,
        nameRw: input.nameRw ?? null,
        code: input.code ?? null,
      },
      select: { id: true },
    })
    .catch((error: unknown) => {
      if (isUniqueViolation(error, 'name', 'kind')) {
        throw AppError.duplicate('errors.finance.categoryNameTaken')
      }
      throw error
    })

  await writeAudit(
    { ctx },
    {
      action: 'finance.category.created',
      entityType: 'FinanceCategory',
      entityId: created.id,
      messageKey: 'audit.finance.categoryCreated',
      // The kind is sent as a translation key, in the audit namespace rather than the finance
      // one, so an audit sentence does not depend on a screen's own strings being loaded.
      messageParams: {
        name: input.name,
        nameRw: input.nameRw ?? input.name,
        kind: `audit.finance.kind.${input.kind}`,
      },
      after: { kind: input.kind, name: input.name, nameRw: input.nameRw ?? null },
    },
  )

  const rows = await listCategories(ctx, { includeInactive: 'true' })
  const row = rows.find((candidate) => candidate.id === created.id)
  if (!row) throw AppError.notFound()
  return row
}

/**
 * Renames a category, translates it, or takes it out of use.
 *
 * Deactivating rather than deleting, always. Entries already posted against a category keep
 * pointing at it, and a report covering last year has to be able to name where the money went.
 * The kind cannot change for the same reason: moving a category from income to expense would flip
 * the sign of every entry already posted against it and silently rewrite past months.
 */
export async function updateCategory(
  ctx: RequestContext,
  id: string,
  input: UpdateCategoryInput,
): Promise<CategoryRow> {
  const cooperativeId = requireCooperativeId(ctx)
  const before = await prisma.financeCategory.findFirst({
    where: { id, cooperativeId },
    select: { id: true, name: true, nameRw: true, isActive: true, code: true, kind: true },
  })
  if (!before) throw AppError.notFound()

  await prisma.financeCategory
    .update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.nameRw !== undefined ? { nameRw: input.nameRw } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    })
    .catch((error: unknown) => {
      if (isUniqueViolation(error, 'name', 'kind')) {
        throw AppError.duplicate('errors.finance.categoryNameTaken')
      }
      throw error
    })

  await writeAudit(
    { ctx },
    {
      action: 'finance.category.updated',
      entityType: 'FinanceCategory',
      entityId: id,
      messageKey: 'audit.finance.categoryUpdated',
      messageParams: {
        name: input.name ?? before.name,
        nameRw: input.nameRw ?? before.nameRw ?? input.name ?? before.name,
      },
      before: { name: before.name, nameRw: before.nameRw, isActive: before.isActive },
      after: {
        name: input.name ?? before.name,
        nameRw: input.nameRw !== undefined ? input.nameRw : before.nameRw,
        isActive: input.isActive ?? before.isActive,
      },
    },
  )

  const rows = await listCategories(ctx, { includeInactive: 'true' })
  const row = rows.find((candidate) => candidate.id === id)
  if (!row) throw AppError.notFound()
  return row
}

/** The columns the ledger is exported with, in the order an accountant reads them. */
const EXPORT_HEADERS = [
  'Reference',
  'Date',
  'Kind',
  'Category',
  'Description',
  'Member',
  'Member code',
  'Method',
  'Amount',
  'Status',
  'Corrects',
  'Corrected by',
] as const

async function exportRows(
  cooperativeId: string,
  filters: Omit<ExportTransactionsQuery, 'format'>,
): Promise<TransactionRow[]> {
  const { sort, ...rest } = filters
  const rows = await prisma.financeTransaction.findMany({
    where: buildLedgerWhere(cooperativeId, rest),
    select: ROW_SELECT,
    orderBy: buildLedgerOrder(sort),
    take: 20_000,
  })
  return rows.map(toRow)
}

function exportCells(row: TransactionRow): (string | null)[] {
  return [
    row.reference,
    row.occurredAt,
    row.kind,
    row.categoryName,
    row.description,
    row.memberName,
    row.memberCode,
    row.method,
    row.amount,
    row.status,
    row.reversalOfReference,
    row.reversedByReference,
  ]
}

/**
 * The ledger as CSV.
 *
 * Every value is quoted and internal quotes doubled, which is the whole of the escaping rule and
 * the reason a description containing a comma does not shift every later column. A leading `=`,
 * `+`, `-` or `@` is prefixed with an apostrophe so a spreadsheet treats it as text rather than
 * evaluating it as a formula.
 */
export async function exportTransactionsCsv(
  ctx: RequestContext,
  filters: Omit<ExportTransactionsQuery, 'format'>,
): Promise<string> {
  const cooperativeId = requireCooperativeId(ctx)
  const rows = await exportRows(cooperativeId, filters)

  const lines = [EXPORT_HEADERS.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push(
      exportCells(row)
        .map((value) => csvCell(value ?? ''))
        .join(','),
    )
  }

  await writeAudit(
    { ctx },
    {
      action: 'finance.exported',
      entityType: 'FinanceTransaction',
      messageKey: 'audit.finance.exported',
      messageParams: { count: rows.length, format: 'CSV' },
    },
  )

  // A byte order mark, written as an escape so it is visible in the source rather than an
  // invisible character somebody deletes by accident. Excel on Windows needs it to read the
  // Kinyarwanda characters as UTF-8.
  return `\ufeff${lines.join('\r\n')}\r\n`
}

/**
 * The ledger as a real spreadsheet.
 *
 * The amount is written as a number with a currency format rather than as text, because the first
 * thing anybody does with this file is select the column and look at the sum. That means the value
 * passes through a JavaScript double, which is safe and only safe here: a double carries 15 to 17
 * significant digits and the amount column holds at most 14, so every value the database can store
 * survives exactly. Nothing else in this system converts money to a number.
 */
export async function exportTransactionsXlsx(
  ctx: RequestContext,
  filters: Omit<ExportTransactionsQuery, 'format'>,
): Promise<Buffer> {
  const cooperativeId = requireCooperativeId(ctx)
  const rows = await exportRows(cooperativeId, filters)

  const header = EXPORT_HEADERS.map((value) => ({
    value,
    fontWeight: 'bold' as const,
    backgroundColor: '#F1F5F9',
  }))

  const body = rows.map((row) => {
    const cells = exportCells(row)
    return cells.map((value, index) => {
      if (index === 8) {
        return { type: Number, value: amountAsNumber(row.amount), format: '#,##0.00' }
      }
      if (index === 1) {
        return {
          type: Date,
          value: new Date(`${row.occurredAt}T00:00:00.000Z`),
          format: 'yyyy-mm-dd',
        }
      }
      return { type: String, value: value ?? '' }
    })
  })

  const columns = [
    { width: 18 },
    { width: 12 },
    { width: 10 },
    { width: 24 },
    { width: 40 },
    { width: 24 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 10 },
    { width: 16 },
    { width: 16 },
  ]

  // No file path and no stream, so the writer hands back an object whose `toBuffer` resolves to
  // the finished workbook. The response is sent from memory; a cooperative's ledger is thousands
  // of rows at most.
  const data: SheetData = [header, ...body]
  const buffer = await writeXlsxFile(data, {
    columns,
    sheet: 'Ledger',
    // The header stays in view while the reader scrolls, which is the whole reason a real
    // spreadsheet is offered alongside the CSV.
    stickyRowsCount: 1,
  }).toBuffer()

  await writeAudit(
    { ctx },
    {
      action: 'finance.exported',
      entityType: 'FinanceTransaction',
      messageKey: 'audit.finance.exported',
      messageParams: { count: rows.length, format: 'Excel' },
    },
  )

  return buffer
}

/**
 * Converts a decimal string to the number a spreadsheet cell needs, and refuses to guess.
 *
 * If the value does not survive the round trip it is written as zero rather than as something
 * subtly wrong, and that can only happen for a figure the amount column could not have held.
 */
function amountAsNumber(amount: string): number {
  const parsed = Number(amount)
  return Number.isFinite(parsed) && toMoney(parsed.toFixed(MONEY_SCALE)).equals(toMoney(amount))
    ? parsed
    : 0
}
