import type { FinanceKind, FinanceSourceType, PaymentMethod, Prisma } from '@prisma/client'
import { auditWithin } from '../../lib/audit.js'
import type { RequestContext } from '../../lib/context.js'
import { AppError } from '../../lib/errors.js'
import { financePrefixFor, nextFinanceReference, type Db } from '../../lib/references.js'
import { subtract, toMoney, toWire, ZERO, type Money } from '../../lib/money.js'
import { prisma } from '../../lib/prisma.js'

/**
 * Posting into the ledger.
 *
 * Phase 4 needs this because a contribution and a share purchase each create their linked income
 * row in the same database transaction that creates them. The finance *module* — categories,
 * summaries, void and reversal, the screens — is Phase 5; what lives here is the one function
 * everything else posts through, so there is exactly one place a monetary row is written.
 */

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
    select: { id: true, name: true },
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
    status: 'POSTED',
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
