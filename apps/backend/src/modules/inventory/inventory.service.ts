import type { InventoryDirection, InventoryTransactionType, Prisma } from '@prisma/client'
import { auditWithin, writeAudit } from '../../lib/audit.js'
import type { RequestContext } from '../../lib/context.js'
import { AppError } from '../../lib/errors.js'
import {
  add,
  multiply,
  parseQuantity,
  subtract,
  toMoney,
  toWire,
  ZERO,
  type Money,
} from '../../lib/money.js'
import { prisma } from '../../lib/prisma.js'
import { nextInventoryReference } from '../../lib/references.js'
import { postTransaction, voidTransaction } from '../finance/finance.service.js'
import { reviewLowStock } from './lowStock.js'
import { decreaseStock, increaseStock } from './stock.js'
import type {
  AdjustInput,
  IssueInput,
  ListMovementsQuery,
  ListStockQuery,
  ReceiveInput,
  TransferInput,
} from './inventory.schemas.js'

/**
 * The store.
 *
 * Every movement in this module follows the same shape, and it is worth stating once. One database
 * transaction writes the movement row and moves the level, so the history and the balance can
 * never disagree; the quantity is a decimal from end to end and never a float; a decrement is a
 * conditional update that refuses rather than a check followed by a write; and nothing is ever
 * deleted, because a movement recorded in error is reversed by an opposite movement that points
 * at it.
 *
 * `StockLevel` is a cache of `InventoryTransaction`. `rebuild.ts` recomputes it from the history
 * and a test proves the two agree, which is what makes it safe to read the cache everywhere else.
 */

function requireCooperativeId(ctx: RequestContext): string {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw AppError.noCooperativeAccess()
  return cooperativeId
}

/** Which way each kind of movement runs. Stored on the row so a sum need not know the rules. */
export function directionOf(type: InventoryTransactionType): InventoryDirection {
  switch (type) {
    case 'RECEIPT':
    case 'TRANSFER_IN':
    case 'SALE_RETURN':
    case 'OPENING':
      return 'IN'
    case 'ISSUE':
    case 'TRANSFER_OUT':
    case 'SALE_OUT':
      return 'OUT'
    default:
      // An adjustment runs whichever way the count went, so it is never derived from the type.
      throw new Error(`the direction of ${type} depends on the movement, not on its type`)
  }
}

function dayStart(date?: string): Date {
  if (!date) return new Date()
  return new Date(`${date}T00:00:00.000Z`)
}

interface MovementDraft {
  type: InventoryTransactionType
  direction: InventoryDirection
  productId: string
  warehouseId: string
  quantity: Money
  unitId: string
  unitCost?: Money | null
  totalCost?: Money | null
  sourceMemberId?: string | null
  reason?: string | null
  note?: string | null
  occurredAt: Date
  reversalOfId?: string | null
  counterpartyTransactionId?: string | null
  financeTransactionId?: string | null
}

/**
 * Writes one movement row and moves the level with it, inside the caller's transaction.
 *
 * The order matters: the level moves first for an outward movement, so an insufficient stock
 * refusal happens before a reference is spent and before anything is written. For an inward
 * movement the order is immaterial, and the same path is used for both so there is one place a
 * movement is created.
 */
async function writeMovement(
  db: Prisma.TransactionClient,
  ctx: RequestContext,
  cooperativeId: string,
  draft: MovementDraft,
): Promise<{ id: string; reference: string }> {
  const key = {
    cooperativeId,
    productId: draft.productId,
    warehouseId: draft.warehouseId,
  }

  if (draft.direction === 'OUT') await decreaseStock(db, key, draft.quantity)
  else await increaseStock(db, key, draft.quantity)

  const reference = await nextInventoryReference(db, cooperativeId, draft.occurredAt)

  const row = await db.inventoryTransaction.create({
    data: {
      cooperativeId,
      reference,
      type: draft.type,
      direction: draft.direction,
      productId: draft.productId,
      warehouseId: draft.warehouseId,
      quantity: draft.quantity,
      unitId: draft.unitId,
      unitCost: draft.unitCost ?? null,
      totalCost: draft.totalCost ?? null,
      sourceMemberId: draft.sourceMemberId ?? null,
      reason: draft.reason ?? null,
      note: draft.note ?? null,
      occurredAt: draft.occurredAt,
      reversalOfId: draft.reversalOfId ?? null,
      counterpartyTransactionId: draft.counterpartyTransactionId ?? null,
      financeTransactionId: draft.financeTransactionId ?? null,
      createdById: ctx.user.id,
    },
    select: { id: true, reference: true },
  })

  return row
}

/**
 * Loads the product a movement is about, refusing anything the movement cannot be made against.
 *
 * A product from another cooperative reads as not found, a retired one is refused with a reason,
 * and a service is refused because it is not counted: a day of tractor hire has no quantity in a
 * store and pretending otherwise would put a number on the overview that means nothing.
 */
async function productForMovement(
  db: Prisma.TransactionClient,
  cooperativeId: string,
  productId: string,
): Promise<{
  id: string
  unitId: string
  name: string
  /** Null where the cooperative gave no Kinyarwanda name; the audit entry falls back to `name`. */
  nameRw: string | null
  sku: string
  minStockLevel: Money | null
}> {
  const product = await db.product.findFirst({
    where: { id: productId, cooperativeId },
    select: {
      id: true,
      unitId: true,
      name: true,
      // The Kinyarwanda name comes along so every movement's audit entry can record both.
      nameRw: true,
      sku: true,
      isActive: true,
      trackInventory: true,
      minStockLevel: true,
    },
  })
  if (!product) throw AppError.notFound()

  if (!product.isActive) {
    throw AppError.conflict(
      'errors.inventory.productRetired',
      'That product has been retired. Bring it back into use before recording stock against it.',
    )
  }
  if (!product.trackInventory) {
    throw AppError.conflict(
      'errors.inventory.productNotCounted',
      'That product is not counted in the store, so there is no stock to move.',
    )
  }

  return {
    id: product.id,
    unitId: product.unitId,
    name: product.name,
    nameRw: product.nameRw,
    sku: product.sku,
    minStockLevel: product.minStockLevel,
  }
}

async function warehouseForMovement(
  db: Prisma.TransactionClient,
  cooperativeId: string,
  warehouseId: string,
): Promise<{ id: string; name: string }> {
  const warehouse = await db.warehouse.findFirst({
    where: { id: warehouseId, cooperativeId },
    select: { id: true, name: true, isActive: true },
  })
  if (!warehouse) throw AppError.notFound()
  if (!warehouse.isActive) {
    throw AppError.conflict(
      'errors.inventory.warehouseClosed',
      'That store is closed. Move the stock to an open one, or reopen it first.',
    )
  }
  return { id: warehouse.id, name: warehouse.name }
}

export interface MovementResult {
  id: string
  reference: string
  type: InventoryTransactionType
  direction: InventoryDirection
  quantity: string
  /** The level in that warehouse after the movement, which is what the screen shows next. */
  quantityAfter: string
  /** The finance entry the movement created, where the cooperative paid on receipt. */
  financeReference: string | null
}

async function levelAfter(
  db: Prisma.TransactionClient,
  productId: string,
  warehouseId: string,
): Promise<string> {
  const level = await db.stockLevel.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    select: { quantity: true },
  })
  return toWire(level?.quantity ?? ZERO, 3)
}

/**
 * Stock arriving.
 *
 * Optionally posts the expense at the same time, in the same transaction, because a cooperative
 * that pays a member on delivery has moved money and moved stock in one act. A receipt that
 * created the stock but not the expense would leave the books short by exactly that amount with
 * nothing to show why — the same failure a contribution without its income row would be.
 */
export async function receiveStock(
  ctx: RequestContext,
  input: ReceiveInput,
): Promise<MovementResult> {
  const cooperativeId = requireCooperativeId(ctx)
  const quantity = parseQuantity(input.quantity, 'body.quantity')
  const occurredAt = dayStart(input.occurredAt)
  const unitCost =
    input.unitCost === undefined ? null : parseQuantity(input.unitCost, 'body.unitCost')
  const totalCost = unitCost === null ? null : multiply(unitCost, quantity)

  const result = await prisma.$transaction(async (tx) => {
    const product = await productForMovement(tx, cooperativeId, input.productId)
    await warehouseForMovement(tx, cooperativeId, input.warehouseId)

    if (input.sourceMemberId) {
      const member = await tx.member.findFirst({
        where: { id: input.sourceMemberId, cooperativeId },
        select: { id: true },
      })
      if (!member) {
        throw AppError.validationFailed([
          { field: 'body.sourceMemberId', messageKey: 'validation.invalid_value' },
        ])
      }
    }

    let financeTransactionId: string | null = null
    let financeReference: string | null = null
    if (input.expenseCategoryId && totalCost !== null) {
      const posted = await postTransaction(tx, ctx, {
        kind: 'EXPENSE',
        categoryId: input.expenseCategoryId,
        amount: totalCost,
        occurredAt,
        method: input.method ?? 'CASH',
        description: `Stock received: ${toWire(quantity, 3)} of ${product.name} (${product.sku})`,
        sourceType: 'STOCK_PURCHASE',
        memberId: input.sourceMemberId ?? null,
      })
      financeTransactionId = posted.id
      financeReference = posted.reference
    }

    const movement = await writeMovement(tx, ctx, cooperativeId, {
      type: 'RECEIPT',
      direction: 'IN',
      productId: product.id,
      warehouseId: input.warehouseId,
      quantity,
      unitId: product.unitId,
      unitCost,
      totalCost,
      sourceMemberId: input.sourceMemberId ?? null,
      note: input.note ?? null,
      occurredAt,
      financeTransactionId,
    })

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'inventory.received',
        entityType: 'InventoryTransaction',
        entityId: movement.id,
        messageKey: 'audit.inventory.received',
        messageParams: {
          quantity: toWire(quantity, 3),
          product: product.name,
          productRw: product.nameRw ?? product.name,
          reference: movement.reference,
        },
        after: {
          type: 'RECEIPT',
          quantity: toWire(quantity, 3),
          warehouseId: input.warehouseId,
          financeReference,
        },
      },
    )

    return {
      id: movement.id,
      reference: movement.reference,
      type: 'RECEIPT' as const,
      direction: 'IN' as const,
      quantity: toWire(quantity, 3),
      quantityAfter: await levelAfter(tx, product.id, input.warehouseId),
      financeReference,
    }
  })

  // After the transaction, so a notification is never written for a movement that rolled back.
  await reviewLowStock(ctx, [input.productId])
  return result
}

/** Stock leaving for any reason other than a sale. */
export async function issueStock(ctx: RequestContext, input: IssueInput): Promise<MovementResult> {
  const cooperativeId = requireCooperativeId(ctx)
  const quantity = parseQuantity(input.quantity, 'body.quantity')
  const occurredAt = dayStart(input.occurredAt)

  const result = await prisma.$transaction(async (tx) => {
    const product = await productForMovement(tx, cooperativeId, input.productId)
    await warehouseForMovement(tx, cooperativeId, input.warehouseId)

    const movement = await writeMovement(tx, ctx, cooperativeId, {
      type: 'ISSUE',
      direction: 'OUT',
      productId: product.id,
      warehouseId: input.warehouseId,
      quantity,
      unitId: product.unitId,
      reason: input.reason ?? null,
      note: input.note ?? null,
      occurredAt,
    })

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'inventory.issued',
        entityType: 'InventoryTransaction',
        entityId: movement.id,
        messageKey: 'audit.inventory.issued',
        messageParams: {
          quantity: toWire(quantity, 3),
          product: product.name,
          productRw: product.nameRw ?? product.name,
          reference: movement.reference,
        },
        after: { type: 'ISSUE', quantity: toWire(quantity, 3), warehouseId: input.warehouseId },
      },
    )

    return {
      id: movement.id,
      reference: movement.reference,
      type: 'ISSUE' as const,
      direction: 'OUT' as const,
      quantity: toWire(quantity, 3),
      quantityAfter: await levelAfter(tx, product.id, input.warehouseId),
      financeReference: null,
    }
  })

  await reviewLowStock(ctx, [input.productId])
  return result
}

/**
 * A count that disagreed with the record.
 *
 * The caller says what they counted and this works out the correction, because asking a
 * storekeeper to decide whether the difference is plus or minus two is how the wrong sign gets
 * recorded. A count that agrees with the record is refused rather than written as a movement of
 * nothing: the check constraint would refuse a quantity of zero anyway, and "nothing changed" is
 * a better answer than an empty row in the history.
 */
export async function adjustStock(
  ctx: RequestContext,
  input: AdjustInput,
): Promise<MovementResult> {
  const cooperativeId = requireCooperativeId(ctx)
  const counted = parseQuantity(input.countedQuantity, 'body.countedQuantity', { allowZero: true })
  const occurredAt = dayStart(input.occurredAt)

  const result = await prisma.$transaction(async (tx) => {
    const product = await productForMovement(tx, cooperativeId, input.productId)
    await warehouseForMovement(tx, cooperativeId, input.warehouseId)

    const level = await tx.stockLevel.findUnique({
      where: { productId_warehouseId: { productId: product.id, warehouseId: input.warehouseId } },
      select: { quantity: true },
    })
    const onRecord = level?.quantity ?? ZERO
    const difference = subtract(counted, onRecord)

    if (difference.isZero()) {
      throw AppError.conflict(
        'errors.inventory.countAgrees',
        'That count matches the record, so there is nothing to correct.',
      )
    }

    const direction: InventoryDirection = difference.isPositive() ? 'IN' : 'OUT'
    const quantity = difference.abs()

    const movement = await writeMovement(tx, ctx, cooperativeId, {
      type: 'ADJUSTMENT',
      direction,
      productId: product.id,
      warehouseId: input.warehouseId,
      quantity,
      unitId: product.unitId,
      reason: input.reason,
      note: input.note ?? null,
      occurredAt,
    })

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'inventory.adjusted',
        entityType: 'InventoryTransaction',
        entityId: movement.id,
        messageKey: 'audit.inventory.adjusted',
        messageParams: {
          product: product.name,
          productRw: product.nameRw ?? product.name,
          from: toWire(onRecord, 3),
          to: toWire(counted, 3),
          reference: movement.reference,
        },
        before: { quantity: toWire(onRecord, 3) },
        after: { quantity: toWire(counted, 3), reason: input.reason },
      },
    )

    return {
      id: movement.id,
      reference: movement.reference,
      type: 'ADJUSTMENT' as const,
      direction,
      quantity: toWire(quantity, 3),
      quantityAfter: await levelAfter(tx, product.id, input.warehouseId),
      financeReference: null,
    }
  })

  await reviewLowStock(ctx, [input.productId])
  return result
}

export interface TransferResult {
  out: MovementResult
  in: MovementResult
}

/**
 * Stock moving between two of the cooperative's own stores.
 *
 * Two rows, each naming the other, in one transaction. One row would leave the history unable to
 * say where the stock went, and two transactions would leave a window in which the cooperative
 * owned nothing at all.
 */
export async function transferStock(
  ctx: RequestContext,
  input: TransferInput,
): Promise<TransferResult> {
  const cooperativeId = requireCooperativeId(ctx)
  const quantity = parseQuantity(input.quantity, 'body.quantity')
  const occurredAt = dayStart(input.occurredAt)

  const result = await prisma.$transaction(async (tx) => {
    const product = await productForMovement(tx, cooperativeId, input.productId)
    const from = await warehouseForMovement(tx, cooperativeId, input.fromWarehouseId)
    const to = await warehouseForMovement(tx, cooperativeId, input.toWarehouseId)

    // The outward half first, so an insufficient stock refusal happens before anything is written.
    const outward = await writeMovement(tx, ctx, cooperativeId, {
      type: 'TRANSFER_OUT',
      direction: 'OUT',
      productId: product.id,
      warehouseId: from.id,
      quantity,
      unitId: product.unitId,
      note: input.note ?? null,
      occurredAt,
    })

    const inward = await writeMovement(tx, ctx, cooperativeId, {
      type: 'TRANSFER_IN',
      direction: 'IN',
      productId: product.id,
      warehouseId: to.id,
      quantity,
      unitId: product.unitId,
      note: input.note ?? null,
      occurredAt,
      counterpartyTransactionId: outward.id,
    })

    // The pairing is set on both halves, so either end of the history names the other.
    await tx.inventoryTransaction.update({
      where: { id: outward.id },
      data: { counterpartyTransactionId: inward.id },
    })

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'inventory.transferred',
        entityType: 'InventoryTransaction',
        entityId: outward.id,
        messageKey: 'audit.inventory.transferred',
        messageParams: {
          quantity: toWire(quantity, 3),
          product: product.name,
          productRw: product.nameRw ?? product.name,
          from: from.name,
          to: to.name,
        },
        after: { out: outward.reference, in: inward.reference },
      },
    )

    return {
      out: {
        id: outward.id,
        reference: outward.reference,
        type: 'TRANSFER_OUT' as const,
        direction: 'OUT' as const,
        quantity: toWire(quantity, 3),
        quantityAfter: await levelAfter(tx, product.id, from.id),
        financeReference: null,
      },
      in: {
        id: inward.id,
        reference: inward.reference,
        type: 'TRANSFER_IN' as const,
        direction: 'IN' as const,
        quantity: toWire(quantity, 3),
        quantityAfter: await levelAfter(tx, product.id, to.id),
        financeReference: null,
      },
    }
  })

  await reviewLowStock(ctx, [input.productId])
  return result
}

/**
 * What a reversal of each kind of movement is.
 *
 * The opposite movement is given a type that reads correctly on its own, rather than the original
 * type with the direction flipped: a row saying "RECEIPT, outward" would be a puzzle for whoever
 * reads the history next year. `reversalOfId` is what records that the two are a pair.
 */
function reversalTypeFor(type: InventoryTransactionType): InventoryTransactionType {
  switch (type) {
    case 'RECEIPT':
    case 'OPENING':
      return 'ISSUE'
    case 'ISSUE':
      return 'RECEIPT'
    case 'TRANSFER_OUT':
      return 'TRANSFER_IN'
    case 'TRANSFER_IN':
      return 'TRANSFER_OUT'
    case 'SALE_OUT':
      return 'SALE_RETURN'
    case 'SALE_RETURN':
      return 'SALE_OUT'
    default:
      return 'ADJUSTMENT'
  }
}

/**
 * Reverses a movement recorded in error.
 *
 * Both halves of a transfer are reversed together. Undoing one half would leave the stock in a
 * store it never reached, which is a worse record than the mistake being corrected.
 *
 * Where the movement posted an expense, that entry is voided too, by the same reversal the finance
 * module uses, so the books and the store stay in step.
 */
export async function reverseMovement(
  ctx: RequestContext,
  id: string,
  reason: string,
): Promise<{ reversals: MovementResult[] }> {
  const cooperativeId = requireCooperativeId(ctx)

  const original = await prisma.inventoryTransaction.findFirst({
    where: { id, cooperativeId },
    select: {
      id: true,
      reference: true,
      type: true,
      direction: true,
      productId: true,
      warehouseId: true,
      quantity: true,
      unitId: true,
      unitCost: true,
      totalCost: true,
      sourceMemberId: true,
      occurredAt: true,
      reversalOfId: true,
      financeTransactionId: true,
      counterpartyTransactionId: true,
      reversedBy: { select: { id: true } },
      product: { select: { name: true, nameRw: true } },
    },
  })
  if (!original) throw AppError.notFound()

  if (original.reversedBy) {
    throw AppError.conflict(
      'errors.inventory.alreadyReversed',
      'That movement has already been reversed.',
    )
  }
  if (original.reversalOfId) {
    throw AppError.conflict(
      'errors.inventory.isAReversal',
      'That movement is itself a correction. Record a new movement rather than reversing it.',
    )
  }

  // Both halves of a transfer, or just the one movement.
  const ids = original.counterpartyTransactionId
    ? [original.id, original.counterpartyTransactionId]
    : [original.id]

  const halves = await prisma.inventoryTransaction.findMany({
    where: { id: { in: ids }, cooperativeId },
    select: {
      id: true,
      reference: true,
      type: true,
      direction: true,
      productId: true,
      warehouseId: true,
      quantity: true,
      unitId: true,
      occurredAt: true,
      financeTransactionId: true,
      reversedBy: { select: { id: true } },
    },
    // The inward half is reversed first: taking stock back out of the destination has to succeed
    // before the outward half puts it back, or a transfer could be half undone.
    orderBy: { direction: 'asc' },
  })

  if (halves.some((half) => half.reversedBy)) {
    throw AppError.conflict(
      'errors.inventory.alreadyReversed',
      'That movement has already been reversed.',
    )
  }

  const results = await prisma.$transaction(async (tx) => {
    const written: MovementResult[] = []

    for (const half of halves) {
      const type = reversalTypeFor(half.type)
      const direction: InventoryDirection = half.direction === 'IN' ? 'OUT' : 'IN'

      const movement = await writeMovement(tx, ctx, cooperativeId, {
        type,
        direction,
        productId: half.productId,
        warehouseId: half.warehouseId,
        quantity: half.quantity,
        unitId: half.unitId,
        // The reversal takes the original's date, so a correction does not move stock between
        // periods that have already been reported on.
        occurredAt: half.occurredAt,
        reason,
        reversalOfId: half.id,
      })

      let financeReference: string | null = null
      if (half.financeTransactionId) {
        const voided = await voidTransaction(tx, ctx, half.financeTransactionId, reason)
        financeReference = voided.reversal.reference
      }

      written.push({
        id: movement.id,
        reference: movement.reference,
        type,
        direction,
        quantity: toWire(half.quantity, 3),
        quantityAfter: await levelAfter(tx, half.productId, half.warehouseId),
        financeReference,
      })
    }

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'inventory.reversed',
        entityType: 'InventoryTransaction',
        entityId: original.id,
        messageKey: 'audit.inventory.reversed',
        messageParams: {
          reference: original.reference,
          product: original.product.name,
          productRw: original.product.nameRw ?? original.product.name,
        },
        before: { reference: original.reference, quantity: toWire(original.quantity, 3) },
        after: { reversals: written.map((row) => row.reference).join(', '), reason },
      },
    )

    return written
  })

  await reviewLowStock(ctx, [original.productId])
  return { reversals: results }
}

export interface StockRow {
  productId: string
  sku: string
  productName: string
  productNameRw: string | null
  categoryName: string | null
  unitSymbol: string
  warehouseId: string
  warehouseName: string
  quantity: string
  /**
   * The same product across every store, which is what the minimum is compared against. A row
   * shows its own store's quantity and this figure beside it, so a storekeeper can see that the
   * main store is down to its last ton while the collection point still has eight.
   */
  quantityInAllStores: string
  minStockLevel: string | null
  /** True when the total across every store is at or below the minimum somebody set. */
  isLow: boolean
}

/**
 * What is in the store, by product and warehouse.
 *
 * Read from `StockLevel` rather than summed over the history on every request, which is the whole
 * reason that table exists. The rebuild command and its test are what make reading the cache
 * defensible.
 */
export async function listStock(
  ctx: RequestContext,
  query: ListStockQuery,
): Promise<{ items: StockRow[]; total: number; lowCount: number }> {
  const cooperativeId = requireCooperativeId(ctx)
  const search = query.q?.trim()

  const where: Prisma.StockLevelWhereInput = {
    cooperativeId,
    ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    ...(query.inStockOnly === 'true' ? { quantity: { gt: 0 } } : {}),
    product: {
      isActive: true,
      trackInventory: true,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { sku: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
  }

  const orderBy: Prisma.StockLevelOrderByWithRelationInput[] =
    query.sort === 'quantity'
      ? [{ quantity: 'asc' }]
      : query.sort === '-quantity'
        ? [{ quantity: 'desc' }]
        : query.sort === '-product'
          ? [{ product: { name: 'desc' } }]
          : [{ product: { name: 'asc' } }]

  const [rows, total] = await Promise.all([
    prisma.stockLevel.findMany({
      where,
      select: {
        productId: true,
        warehouseId: true,
        quantity: true,
        warehouse: { select: { name: true } },
        product: {
          select: {
            sku: true,
            name: true,
            nameRw: true,
            minStockLevel: true,
            unit: { select: { symbol: true } },
            category: { select: { name: true } },
          },
        },
      },
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.stockLevel.count({ where }),
  ])

  // Whether a product is low is a question about the cooperative, not about one store. The
  // minimum means "we want at least this much of it", so a cooperative holding eight tonnes of
  // potatoes at the collection point is not short of potatoes because the main store is down to
  // its last ton. Marking the row low on its own quantity made the overview disagree with the
  // low-stock warnings, which sum across stores — and two different answers to the same question
  // is worse than either.
  const totals =
    rows.length === 0
      ? []
      : await prisma.stockLevel.groupBy({
          by: ['productId'],
          where: { cooperativeId, productId: { in: rows.map((row) => row.productId) } },
          _sum: { quantity: true },
        })
  const heldInAll = new Map(totals.map((row) => [row.productId, row._sum.quantity]))

  const items = rows.map((row) => {
    const minimum = row.product.minStockLevel
    const acrossStores = heldInAll.get(row.productId) ?? row.quantity
    return {
      productId: row.productId,
      sku: row.product.sku,
      productName: row.product.name,
      productNameRw: row.product.nameRw,
      categoryName: row.product.category?.name ?? null,
      unitSymbol: row.product.unit.symbol,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse.name,
      quantity: toWire(row.quantity, 3),
      quantityInAllStores: toWire(acrossStores, 3),
      minStockLevel: minimum === null ? null : toWire(minimum, 3),
      isLow: minimum !== null && acrossStores.lte(minimum),
    }
  })

  const lowCount = await countLowStock(cooperativeId)

  return {
    // Filtering to the low rows is done here rather than in SQL, because "at or below the
    // minimum" compares two columns of different tables and the database cannot index that. The
    // page is at most a hundred rows, so the cost is nothing.
    items: query.lowOnly === 'true' ? items.filter((row) => row.isLow) : items,
    total,
    lowCount,
  }
}

/**
 * How many products are at or below their minimum, counting each product once across every store.
 *
 * The same definition the low-stock watch uses, so the figure on the overview and the number of
 * warnings raised can never disagree.
 */
export async function countLowStock(cooperativeId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count
      FROM (
        SELECT p.id
          FROM products p
          JOIN stock_levels l ON l.product_id = p.id
         WHERE p.cooperative_id = ${cooperativeId}::uuid
           AND p.is_active
           AND p.track_inventory
           AND p.min_stock_level IS NOT NULL
         GROUP BY p.id, p.min_stock_level
        HAVING sum(l.quantity) <= p.min_stock_level
      ) low
  `
  return Number(rows[0]?.count ?? 0)
}

export interface MovementRow {
  id: string
  reference: string
  type: InventoryTransactionType
  direction: InventoryDirection
  productId: string
  productName: string
  sku: string
  unitSymbol: string
  warehouseId: string
  warehouseName: string
  quantity: string
  unitCost: string | null
  totalCost: string | null
  memberId: string | null
  memberName: string | null
  reason: string | null
  note: string | null
  occurredAt: string
  reversalOfReference: string | null
  reversedByReference: string | null
  counterpartyReference: string | null
  financeReference: string | null
}

export async function listMovements(
  ctx: RequestContext,
  query: ListMovementsQuery,
): Promise<{ items: MovementRow[]; total: number; totals: { in: string; out: string } }> {
  const cooperativeId = requireCooperativeId(ctx)
  const search = query.q?.trim()

  const where: Prisma.InventoryTransactionWhereInput = {
    cooperativeId,
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    ...(query.memberId ? { sourceMemberId: query.memberId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.direction ? { direction: query.direction } : {}),
    ...(query.from || query.to
      ? {
          occurredAt: {
            ...(query.from ? { gte: dayStart(query.from) } : {}),
            ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { reference: { contains: search, mode: 'insensitive' } },
            { product: { name: { contains: search, mode: 'insensitive' } } },
            { product: { sku: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }

  const orderBy: Prisma.InventoryTransactionOrderByWithRelationInput[] =
    query.sort === 'occurredAt'
      ? [{ occurredAt: 'asc' }, { reference: 'asc' }]
      : query.sort === 'reference'
        ? [{ reference: 'asc' }]
        : query.sort === '-reference'
          ? [{ reference: 'desc' }]
          : [{ occurredAt: 'desc' }, { reference: 'desc' }]

  const [rows, total, inward, outward] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where,
      select: {
        id: true,
        reference: true,
        type: true,
        direction: true,
        productId: true,
        warehouseId: true,
        quantity: true,
        unitCost: true,
        totalCost: true,
        sourceMemberId: true,
        reason: true,
        note: true,
        occurredAt: true,
        product: { select: { name: true, sku: true, unit: { select: { symbol: true } } } },
        warehouse: { select: { name: true } },
        sourceMember: { select: { firstName: true, lastName: true } },
        reversalOf: { select: { reference: true } },
        reversedBy: { select: { reference: true } },
        counterparty: { select: { reference: true } },
        financeTransaction: { select: { reference: true } },
      },
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.inventoryTransaction.count({ where }),
    prisma.inventoryTransaction.aggregate({
      where: { AND: [where, { direction: 'IN' }] },
      _sum: { quantity: true },
    }),
    prisma.inventoryTransaction.aggregate({
      where: { AND: [where, { direction: 'OUT' }] },
      _sum: { quantity: true },
    }),
  ])

  return {
    items: rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      type: row.type,
      direction: row.direction,
      productId: row.productId,
      productName: row.product.name,
      sku: row.product.sku,
      unitSymbol: row.product.unit.symbol,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse.name,
      quantity: toWire(row.quantity, 3),
      unitCost: row.unitCost === null ? null : toWire(row.unitCost),
      totalCost: row.totalCost === null ? null : toWire(row.totalCost),
      memberId: row.sourceMemberId,
      memberName: row.sourceMember
        ? `${row.sourceMember.firstName} ${row.sourceMember.lastName}`
        : null,
      reason: row.reason,
      note: row.note,
      occurredAt: row.occurredAt.toISOString(),
      reversalOfReference: row.reversalOf?.reference ?? null,
      reversedByReference: row.reversedBy?.reference ?? null,
      counterpartyReference: row.counterparty?.reference ?? null,
      financeReference: row.financeTransaction?.reference ?? null,
    })),
    total,
    totals: {
      in: toWire(inward._sum.quantity ?? ZERO, 3),
      out: toWire(outward._sum.quantity ?? ZERO, 3),
    },
  }
}

export interface ValuationRow {
  productId: string
  sku: string
  productName: string
  unitSymbol: string
  quantity: string
  /** Weighted average of what the cooperative actually paid, not a list price. */
  unitCost: string | null
  value: string
  /** True when nothing costed has ever been received, so the figure rests on the default price. */
  costIsEstimated: boolean
}

/**
 * What the stock is worth.
 *
 * The unit cost is the weighted average of what the cooperative actually paid across every costed
 * receipt, because that is the only figure the store itself can support. Where nothing costed has
 * ever been received the product's default purchase price is used and the row says so, rather than
 * being valued at nothing and quietly understating the total — a cooperative taking this figure to
 * a lender needs to know which part of it is an estimate.
 */
export async function stockValuation(ctx: RequestContext): Promise<{
  rows: ValuationRow[]
  total: string
  estimatedCount: number
}> {
  const cooperativeId = requireCooperativeId(ctx)

  const levels = await prisma.stockLevel.groupBy({
    by: ['productId'],
    where: {
      cooperativeId,
      quantity: { gt: 0 },
      product: { isActive: true, trackInventory: true },
    },
    _sum: { quantity: true },
  })
  if (levels.length === 0) return { rows: [], total: '0.00', estimatedCount: 0 }

  const productIds = levels.map((row) => row.productId)

  const [products, costed] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        sku: true,
        name: true,
        defaultPurchasePrice: true,
        unit: { select: { symbol: true } },
      },
    }),
    prisma.inventoryTransaction.groupBy({
      by: ['productId'],
      where: {
        cooperativeId,
        productId: { in: productIds },
        direction: 'IN',
        totalCost: { not: null },
        // A reversed receipt did not happen, so its cost must not weight the average.
        reversedBy: null,
        reversalOfId: null,
      },
      _sum: { quantity: true, totalCost: true },
    }),
  ])

  const byProduct = new Map(products.map((row) => [row.id, row]))
  const costs = new Map(costed.map((row) => [row.productId, row]))

  let total = ZERO
  let estimatedCount = 0
  const rows: ValuationRow[] = []

  for (const level of levels) {
    const product = byProduct.get(level.productId)
    if (!product) continue
    const quantity = level._sum.quantity ?? ZERO
    const receipts = costs.get(level.productId)

    let unitCost: Money | null = null
    let estimated = false
    const costedQuantity = receipts?._sum.quantity ?? ZERO
    const costedTotal = receipts?._sum.totalCost ?? ZERO

    if (!costedQuantity.isZero()) {
      unitCost = toMoney(costedTotal.div(costedQuantity).toFixed(2))
    } else if (product.defaultPurchasePrice !== null) {
      unitCost = product.defaultPurchasePrice
      estimated = true
    }

    if (estimated) estimatedCount += 1
    const value = unitCost === null ? ZERO : multiply(unitCost, quantity)
    total = add(total, value)

    rows.push({
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      unitSymbol: product.unit.symbol,
      quantity: toWire(quantity, 3),
      unitCost: unitCost === null ? null : toWire(unitCost),
      value: toWire(value),
      costIsEstimated: estimated,
    })
  }

  rows.sort(
    (a, b) => Number(b.value) - Number(a.value) || a.productName.localeCompare(b.productName),
  )

  await writeAudit(
    { ctx },
    {
      action: 'inventory.valued',
      entityType: 'StockLevel',
      messageKey: 'audit.inventory.valued',
      messageParams: { total: toWire(total), products: rows.length },
    },
  )

  return { rows, total: toWire(total), estimatedCount }
}
