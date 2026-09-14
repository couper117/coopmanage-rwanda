import type { PaymentStatus, Prisma, SaleStatus } from '@prisma/client'
import { auditWithin, writeAudit } from '../../lib/audit.js'
import type { RequestContext } from '../../lib/context.js'
import { isUniqueViolation } from '../../lib/dbErrors.js'
import { AppError } from '../../lib/errors.js'
import {
  add,
  compare,
  fromDatabase,
  multiply,
  parseMoney,
  parseQuantity,
  subtract,
  toWire,
  ZERO,
  type Money,
} from '../../lib/money.js'
import { prisma } from '../../lib/prisma.js'
import { nextInventoryReference, nextSaleReference } from '../../lib/references.js'
import { postTransaction, voidTransaction } from '../finance/finance.service.js'
import { reviewLowStock } from '../inventory/lowStock.js'
import { decreaseStock, increaseStock } from '../inventory/stock.js'
import type {
  ConfirmSaleInput,
  CreateBuyerInput,
  CreateSaleInput,
  ListBuyersQuery,
  ListSalesQuery,
  RecordPaymentInput,
  SalesSummaryQuery,
  UpdateBuyerInput,
  UpdateSaleInput,
} from './sales.schemas.js'

/**
 * Sales.
 *
 * Everything here turns on one decision: **a sale is a draft until somebody confirms it.** While
 * it is a draft the lines are just an intention — nothing has left the store and no money has been
 * recorded — so they can be corrected freely and a half-finished sale costs nothing. Confirming is
 * a single act, and one database transaction: the stock comes out, a movement is written for every
 * line, the payment is recorded if one was taken, the sale is marked, and the trail is written. All
 * of it or none of it.
 *
 * That is not a nicety. The failure it prevents is a sale that took the stock but recorded no
 * money, or recorded the money but left the stock on the shelf, and either one is discovered weeks
 * later when the figures no longer agree.
 *
 * A confirmed sale can never go back to being a draft. It is cancelled, which writes compensating
 * movements that put the stock back and reverses the income — both halves stay in the history, the
 * same way a voided finance entry does.
 */

function requireCooperativeId(ctx: RequestContext): string {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw AppError.noCooperativeAccess()
  return cooperativeId
}

function dayStart(date?: string): Date {
  if (!date) return new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z')
  return new Date(`${date}T00:00:00.000Z`)
}

// ---------------------------------------------------------------------------
// Buyers
// ---------------------------------------------------------------------------

export interface BuyerRow {
  id: string
  name: string
  organization: string | null
  contactPerson: string | null
  phone: string | null
  email: string | null
  tin: string | null
  province: string | null
  district: string | null
  sector: string | null
  address: string | null
  notes: string | null
  isActive: boolean
  /** Confirmed sales only: a draft is an intention, not business done with this buyer. */
  saleCount: number
  totalSold: string
  outstanding: string
  lastSaleDate: string | null
}

const BUYER_SELECT = {
  id: true,
  name: true,
  organization: true,
  contactPerson: true,
  phone: true,
  email: true,
  tin: true,
  province: true,
  district: true,
  sector: true,
  address: true,
  notes: true,
  isActive: true,
} as const

/**
 * Totals per buyer, over confirmed sales only.
 *
 * A draft sale is an intention somebody typed, not business the cooperative did, so counting it
 * would overstate every buyer's history. A cancelled one is business that was undone.
 */
async function buyerTotals(
  cooperativeId: string,
  buyerIds: string[],
): Promise<Map<string, { count: number; total: Money; paid: Money; last: Date | null }>> {
  if (buyerIds.length === 0) return new Map()

  const rows = await prisma.sale.groupBy({
    by: ['buyerId'],
    where: { cooperativeId, buyerId: { in: buyerIds }, status: 'CONFIRMED' },
    _sum: { total: true, amountPaid: true },
    _count: { _all: true },
    _max: { saleDate: true },
  })

  return new Map(
    rows.map((row) => [
      row.buyerId,
      {
        count: row._count._all,
        total: row._sum.total ?? ZERO,
        paid: row._sum.amountPaid ?? ZERO,
        last: row._max.saleDate,
      },
    ]),
  )
}

function toBuyerRow(
  row: Prisma.BuyerGetPayload<{ select: typeof BUYER_SELECT }>,
  totals: { count: number; total: Money; paid: Money; last: Date | null } | undefined,
): BuyerRow {
  // Confirmed sales only, so a cancelled one contributes nothing to either figure and cannot
  // leave a buyer looking as though they owe money for business that was undone.
  const total = totals?.total ?? ZERO
  const paid = totals?.paid ?? ZERO
  return {
    ...row,
    saleCount: totals?.count ?? 0,
    totalSold: toWire(total),
    outstanding: toWire(subtract(total, paid)),
    lastSaleDate: totals?.last?.toISOString().slice(0, 10) ?? null,
  }
}

export async function listBuyers(
  ctx: RequestContext,
  query: ListBuyersQuery,
): Promise<{ items: BuyerRow[]; total: number }> {
  const cooperativeId = requireCooperativeId(ctx)
  const search = query.q?.trim()

  const where: Prisma.BuyerWhereInput = {
    cooperativeId,
    ...(query.includeInactive === 'true' ? {} : { isActive: true }),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { organization: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
          ],
        }
      : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.buyer.findMany({
      where,
      select: BUYER_SELECT,
      orderBy: [{ name: query.sort === '-name' ? 'desc' : 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.buyer.count({ where }),
  ])

  const totals = await buyerTotals(
    cooperativeId,
    rows.map((row) => row.id),
  )
  return { items: rows.map((row) => toBuyerRow(row, totals.get(row.id))), total }
}

export async function getBuyer(ctx: RequestContext, id: string): Promise<BuyerRow> {
  const cooperativeId = requireCooperativeId(ctx)
  const row = await prisma.buyer.findFirst({ where: { id, cooperativeId }, select: BUYER_SELECT })
  if (!row) throw AppError.notFound()
  const totals = await buyerTotals(cooperativeId, [id])
  return toBuyerRow(row, totals.get(id))
}

export async function createBuyer(ctx: RequestContext, input: CreateBuyerInput): Promise<BuyerRow> {
  const cooperativeId = requireCooperativeId(ctx)

  const created = await prisma.buyer
    .create({
      data: {
        cooperativeId,
        name: input.name,
        organization: input.organization ?? null,
        contactPerson: input.contactPerson ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        tin: input.tin ?? null,
        province: input.province ?? null,
        district: input.district ?? null,
        sector: input.sector ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        createdById: ctx.user.id,
      },
      select: { id: true },
    })
    .catch((error: unknown) => {
      if (isUniqueViolation(error, 'name')) throw AppError.duplicate('errors.sales.buyerNameTaken')
      throw error
    })

  await writeAudit(
    { ctx },
    {
      action: 'sales.buyer.created',
      entityType: 'Buyer',
      entityId: created.id,
      messageKey: 'audit.sales.buyerCreated',
      messageParams: { buyer: input.name },
      after: { name: input.name, organization: input.organization ?? null },
    },
  )

  return getBuyer(ctx, created.id)
}

/**
 * Changes a buyer, including taking them out of use.
 *
 * Never deleted: every confirmed sale names them, and a report covering last season has to be able
 * to say who bought the maize.
 */
export async function updateBuyer(
  ctx: RequestContext,
  id: string,
  input: UpdateBuyerInput,
): Promise<BuyerRow> {
  const cooperativeId = requireCooperativeId(ctx)
  const existing = await prisma.buyer.findFirst({
    where: { id, cooperativeId },
    select: { id: true, name: true, isActive: true },
  })
  if (!existing) throw AppError.notFound()

  await prisma.buyer
    .update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.organization !== undefined ? { organization: input.organization } : {}),
        ...(input.contactPerson !== undefined ? { contactPerson: input.contactPerson } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.tin !== undefined ? { tin: input.tin } : {}),
        ...(input.province !== undefined ? { province: input.province } : {}),
        ...(input.district !== undefined ? { district: input.district } : {}),
        ...(input.sector !== undefined ? { sector: input.sector } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    })
    .catch((error: unknown) => {
      if (isUniqueViolation(error, 'name')) throw AppError.duplicate('errors.sales.buyerNameTaken')
      throw error
    })

  await writeAudit(
    { ctx },
    {
      action: 'sales.buyer.updated',
      entityType: 'Buyer',
      entityId: id,
      messageKey: 'audit.sales.buyerUpdated',
      messageParams: { buyer: input.name ?? existing.name },
      before: { name: existing.name, isActive: existing.isActive },
      after: { name: input.name ?? existing.name, isActive: input.isActive ?? existing.isActive },
    },
  )

  return getBuyer(ctx, id)
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export interface SaleLineRow {
  id: string
  productId: string
  productName: string
  sku: string
  unitId: string
  unitSymbol: string
  quantity: string
  unitPrice: string
  lineTotal: string
  note: string | null
  position: number
}

export interface SaleRow {
  id: string
  reference: string
  buyerId: string
  buyerName: string
  warehouseId: string
  warehouseName: string
  saleDate: string
  status: SaleStatus
  paymentStatus: PaymentStatus
  subtotal: string
  discount: string
  taxAmount: string
  total: string
  amountPaid: string
  /** What is still owed. The figure a treasurer chases. */
  outstanding: string
  note: string | null
  confirmedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  lineCount: number
}

export interface SaleDetail extends SaleRow {
  lines: SaleLineRow[]
  /** The income entries recorded against this sale, so a receipt can show what was paid when. */
  payments: { id: string; reference: string; amount: string; method: string; occurredAt: string }[]
  /** The stock that left, which exists only once the sale is confirmed. */
  movements: { id: string; reference: string; productName: string; quantity: string }[]
}

const SALE_SELECT = {
  id: true,
  reference: true,
  buyerId: true,
  warehouseId: true,
  saleDate: true,
  status: true,
  paymentStatus: true,
  subtotal: true,
  discount: true,
  taxAmount: true,
  total: true,
  amountPaid: true,
  note: true,
  confirmedAt: true,
  cancelledAt: true,
  cancelReason: true,
  buyer: { select: { name: true } },
  warehouse: { select: { name: true } },
  _count: { select: { items: true } },
} as const

function toSaleRow(row: Prisma.SaleGetPayload<{ select: typeof SALE_SELECT }>): SaleRow {
  return {
    id: row.id,
    reference: row.reference,
    buyerId: row.buyerId,
    buyerName: row.buyer.name,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    saleDate: row.saleDate.toISOString().slice(0, 10),
    status: row.status,
    paymentStatus: row.paymentStatus,
    subtotal: toWire(row.subtotal),
    discount: toWire(row.discount),
    taxAmount: toWire(row.taxAmount),
    total: toWire(row.total),
    amountPaid: toWire(row.amountPaid),
    // A cancelled sale owes nothing. It keeps its total, because that is what it was worth and a
    // report covering the period has to be able to say so, but a treasurer scanning the owed
    // column must not be sent to chase a buyer for business that was undone.
    outstanding: toWire(row.status === 'CANCELLED' ? ZERO : subtract(row.total, row.amountPaid)),
    note: row.note,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    lineCount: row._count.items,
  }
}

interface PricedLine {
  productId: string
  productName: string
  sku: string
  unitId: string
  quantity: Money
  unitPrice: Money
  lineTotal: Money
  note: string | null
}

/**
 * Prices the lines and checks every product, without touching any stock.
 *
 * Rounding happens once per line, because a line total is a real amount that gets stored and a
 * buyer reads it. The subtotal is then the sum of figures already rounded, which is what somebody
 * adding up the receipt by hand would get.
 */
async function priceLines(
  db: Prisma.TransactionClient,
  cooperativeId: string,
  lines: CreateSaleInput['lines'],
): Promise<{ priced: PricedLine[]; subtotal: Money }> {
  const products = await db.product.findMany({
    where: { id: { in: lines.map((line) => line.productId) }, cooperativeId },
    select: { id: true, name: true, sku: true, unitId: true, isActive: true, trackInventory: true },
  })
  const byId = new Map(products.map((row) => [row.id, row]))

  const priced: PricedLine[] = []
  let subtotal = ZERO

  for (const [index, line] of lines.entries()) {
    const product = byId.get(line.productId)
    if (!product) {
      throw AppError.validationFailed([
        { field: `body.lines.${index}.productId`, messageKey: 'validation.invalid_value' },
      ])
    }
    if (!product.isActive) {
      throw AppError.conflict(
        'errors.sales.productRetired',
        `${product.name} has been retired and cannot be sold. Remove the line or bring the product back into use.`,
      )
    }

    const quantity = parseQuantity(line.quantity, `body.lines.${index}.quantity`)
    const unitPrice = parseMoney(line.unitPrice, {
      field: `body.lines.${index}.unitPrice`,
      // A cooperative does give something away with a sale, and a zero-priced line is how that is
      // recorded rather than by leaving it off the receipt.
      allowZero: true,
    })
    const lineTotal = multiply(unitPrice, quantity)

    priced.push({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      unitId: product.unitId,
      quantity,
      unitPrice,
      lineTotal,
      note: line.note ?? null,
    })
    subtotal = add(subtotal, lineTotal)
  }

  return { priced, subtotal }
}

function saleTotals(
  subtotal: Money,
  discountInput: unknown,
  taxInput: unknown,
): { discount: Money; taxAmount: Money; total: Money } {
  const discount =
    discountInput === undefined
      ? ZERO
      : parseMoney(discountInput, { field: 'body.discount', allowZero: true })
  const taxAmount =
    taxInput === undefined
      ? ZERO
      : parseMoney(taxInput, { field: 'body.taxAmount', allowZero: true })

  if (compare(discount, subtotal) > 0) {
    // A discount larger than what is being discounted turns the sale into a negative total, and
    // every report that sums sales then quietly goes wrong. The database refuses it too.
    throw AppError.validationFailed([
      { field: 'body.discount', messageKey: 'validation.discountTooLarge' },
    ])
  }

  return { discount, taxAmount, total: add(subtract(subtotal, discount), taxAmount) }
}

async function buyerAndWarehouse(
  db: Prisma.TransactionClient,
  cooperativeId: string,
  buyerId: string,
  warehouseId: string,
): Promise<void> {
  const [buyer, warehouse] = await Promise.all([
    db.buyer.findFirst({ where: { id: buyerId, cooperativeId }, select: { isActive: true } }),
    db.warehouse.findFirst({
      where: { id: warehouseId, cooperativeId },
      select: { isActive: true },
    }),
  ])

  if (!buyer) {
    throw AppError.validationFailed([
      { field: 'body.buyerId', messageKey: 'validation.invalid_value' },
    ])
  }
  if (!buyer.isActive) {
    throw AppError.conflict(
      'errors.sales.buyerInactive',
      'That buyer is no longer in use. Choose another, or bring them back into use first.',
    )
  }
  if (!warehouse) {
    throw AppError.validationFailed([
      { field: 'body.warehouseId', messageKey: 'validation.invalid_value' },
    ])
  }
  if (!warehouse.isActive) {
    throw AppError.conflict(
      'errors.sales.warehouseClosed',
      'That store is closed. Choose the store the stock is actually in.',
    )
  }
}

/**
 * Starts a sale as a draft.
 *
 * Nothing is checked against the stock here on purpose. A sale is often written up before the
 * stock is counted, and refusing a draft because the shelf is short would stop somebody recording
 * an order they are about to go and fill. The check happens at confirmation, which is the moment
 * the stock actually leaves.
 */
export async function createSale(ctx: RequestContext, input: CreateSaleInput): Promise<SaleDetail> {
  const cooperativeId = requireCooperativeId(ctx)
  const saleDate = dayStart(input.saleDate)

  const id = await prisma.$transaction(async (tx) => {
    await buyerAndWarehouse(tx, cooperativeId, input.buyerId, input.warehouseId)
    const { priced, subtotal } = await priceLines(tx, cooperativeId, input.lines)
    const { discount, taxAmount, total } = saleTotals(subtotal, input.discount, input.taxAmount)
    const reference = await nextSaleReference(tx, cooperativeId, saleDate)

    const sale = await tx.sale.create({
      data: {
        cooperativeId,
        reference,
        buyerId: input.buyerId,
        warehouseId: input.warehouseId,
        saleDate,
        subtotal,
        discount,
        taxAmount,
        total,
        note: input.note ?? null,
        createdById: ctx.user.id,
        items: {
          create: priced.map((line, position) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitId: line.unitId,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal,
            note: line.note,
            position,
          })),
        },
      },
      select: { id: true, reference: true },
    })

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'sales.sale.drafted',
        entityType: 'Sale',
        entityId: sale.id,
        messageKey: 'audit.sales.drafted',
        messageParams: { reference: sale.reference, total: toWire(total) },
        after: { reference: sale.reference, total: toWire(total), lines: priced.length },
      },
    )

    return sale.id
  })

  return getSale(ctx, id)
}

export async function getSale(ctx: RequestContext, id: string): Promise<SaleDetail> {
  const cooperativeId = requireCooperativeId(ctx)
  const row = await prisma.sale.findFirst({ where: { id, cooperativeId }, select: SALE_SELECT })
  if (!row) throw AppError.notFound()

  const [lines, payments, movements] = await Promise.all([
    prisma.saleItem.findMany({
      where: { saleId: id },
      select: {
        id: true,
        productId: true,
        quantity: true,
        unitId: true,
        unitPrice: true,
        lineTotal: true,
        note: true,
        position: true,
        product: { select: { name: true, sku: true } },
        unit: { select: { symbol: true } },
      },
      orderBy: { position: 'asc' },
    }),
    prisma.financeTransaction.findMany({
      where: { saleId: id, kind: 'INCOME', status: 'POSTED', reversalOfId: null },
      select: { id: true, reference: true, amount: true, method: true, occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    }),
    prisma.inventoryTransaction.findMany({
      where: { saleId: id },
      select: {
        id: true,
        reference: true,
        quantity: true,
        product: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  return {
    ...toSaleRow(row),
    lines: lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productName: line.product.name,
      sku: line.product.sku,
      unitId: line.unitId,
      unitSymbol: line.unit.symbol,
      quantity: toWire(line.quantity, 3),
      unitPrice: toWire(line.unitPrice),
      lineTotal: toWire(line.lineTotal),
      note: line.note,
      position: line.position,
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      reference: payment.reference,
      amount: toWire(payment.amount),
      method: payment.method,
      occurredAt: payment.occurredAt.toISOString().slice(0, 10),
    })),
    movements: movements.map((movement) => ({
      id: movement.id,
      reference: movement.reference,
      productName: movement.product.name,
      quantity: toWire(movement.quantity, 3),
    })),
  }
}

/** Only a draft can be changed. A confirmed sale has left the store and been paid against. */
export async function updateSale(
  ctx: RequestContext,
  id: string,
  input: UpdateSaleInput,
): Promise<SaleDetail> {
  const cooperativeId = requireCooperativeId(ctx)

  await prisma.$transaction(async (tx) => {
    const existing = await tx.sale.findFirst({
      where: { id, cooperativeId },
      select: {
        id: true,
        reference: true,
        status: true,
        buyerId: true,
        warehouseId: true,
        subtotal: true,
        discount: true,
        taxAmount: true,
        total: true,
      },
    })
    if (!existing) throw AppError.notFound()

    if (existing.status !== 'DRAFT') {
      throw AppError.conflict(
        'errors.sales.notADraft',
        'This sale has already been confirmed, so it cannot be changed. Cancel it and record a new one.',
      )
    }

    const buyerId = input.buyerId ?? existing.buyerId
    const warehouseId = input.warehouseId ?? existing.warehouseId
    await buyerAndWarehouse(tx, cooperativeId, buyerId, warehouseId)

    let subtotal = existing.subtotal
    if (input.lines) {
      const { priced, subtotal: recomputed } = await priceLines(tx, cooperativeId, input.lines)
      subtotal = recomputed

      // Replaced wholesale. A line-by-line protocol would leave the subtotal disagreeing with
      // the lines between two requests, and a draft is read and corrected as a whole anyway.
      await tx.saleItem.deleteMany({ where: { saleId: id } })
      await tx.saleItem.createMany({
        data: priced.map((line, position) => ({
          saleId: id,
          productId: line.productId,
          quantity: line.quantity,
          unitId: line.unitId,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
          note: line.note,
          position,
        })),
      })
    }

    const { discount, taxAmount, total } = saleTotals(
      subtotal,
      input.discount ?? toWire(existing.discount),
      input.taxAmount ?? toWire(existing.taxAmount),
    )

    await tx.sale.update({
      where: { id },
      data: {
        buyerId,
        warehouseId,
        ...(input.saleDate ? { saleDate: dayStart(input.saleDate) } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        subtotal,
        discount,
        taxAmount,
        total,
      },
    })

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'sales.sale.updated',
        entityType: 'Sale',
        entityId: id,
        messageKey: 'audit.sales.updated',
        messageParams: { reference: existing.reference },
        before: { total: toWire(existing.total) },
        after: { total: toWire(total) },
      },
    )
  })

  return getSale(ctx, id)
}

/**
 * Confirming a sale.
 *
 * One transaction, and the order matters. The stock is taken first, line by line, so that a sale
 * the store cannot fill is refused before anything else has happened — including the second line,
 * whose decrement must not survive the first line failing. Then the movements, then the payment,
 * then the sale itself, then the trail.
 *
 * If any step raises, the whole thing rolls back and the sale is still a draft with the stock
 * untouched and no money recorded. That is the Phase 7 exit criterion, and it is a property of
 * using one transaction rather than something checked afterwards.
 */
export async function confirmSale(
  ctx: RequestContext,
  id: string,
  input: ConfirmSaleInput,
): Promise<SaleDetail> {
  const cooperativeId = requireCooperativeId(ctx)

  const amountPaid =
    input.amountPaid === undefined
      ? null
      : parseMoney(input.amountPaid, { field: 'body.amountPaid', allowZero: true })

  const productIds = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id, cooperativeId },
      select: {
        id: true,
        reference: true,
        status: true,
        buyerId: true,
        warehouseId: true,
        saleDate: true,
        total: true,
        items: {
          select: {
            productId: true,
            quantity: true,
            unitId: true,
            product: { select: { name: true, trackInventory: true } },
          },
          orderBy: { position: 'asc' },
        },
      },
    })
    if (!sale) throw AppError.notFound()

    if (sale.status === 'CONFIRMED') {
      throw AppError.conflict(
        'errors.sales.alreadyConfirmed',
        'That sale has already been confirmed.',
      )
    }
    if (sale.status === 'CANCELLED') {
      throw AppError.conflict(
        'errors.sales.cancelled',
        'That sale was cancelled. Record a new one rather than confirming this.',
      )
    }
    if (sale.items.length === 0) {
      throw AppError.conflict(
        'errors.sales.noLines',
        'This sale has no lines, so there is nothing to confirm.',
      )
    }

    if (amountPaid !== null && compare(amountPaid, sale.total) > 0) {
      // Taking more than the sale is worth is a data-entry slip, not a payment. Change on a note
      // is the buyer's business, not the cooperative's books.
      throw AppError.validationFailed([
        { field: 'body.amountPaid', messageKey: 'validation.paymentExceedsTotal' },
      ])
    }

    // The stock first, and every line before anything else is written. The conditional decrement
    // refuses rather than going negative, and because this is one transaction the first line's
    // decrement is undone when the second line is short.
    for (const line of sale.items) {
      if (!line.product.trackInventory) continue
      await decreaseStock(
        tx,
        { cooperativeId, productId: line.productId, warehouseId: sale.warehouseId },
        line.quantity,
      )
    }

    for (const line of sale.items) {
      if (!line.product.trackInventory) continue
      const reference = await nextInventoryReference(tx, cooperativeId, sale.saleDate)
      await tx.inventoryTransaction.create({
        data: {
          cooperativeId,
          reference,
          type: 'SALE_OUT',
          direction: 'OUT',
          productId: line.productId,
          warehouseId: sale.warehouseId,
          quantity: line.quantity,
          unitId: line.unitId,
          buyerId: sale.buyerId,
          saleId: sale.id,
          occurredAt: sale.saleDate,
          createdById: ctx.user.id,
        },
      })
    }

    let paymentStatus: PaymentStatus = 'UNPAID'
    let paid = ZERO

    if (amountPaid !== null && !amountPaid.isZero()) {
      if (!input.incomeCategoryId) {
        throw AppError.validationFailed([
          { field: 'body.incomeCategoryId', messageKey: 'validation.required' },
        ])
      }
      const posted = await postTransaction(tx, ctx, {
        kind: 'INCOME',
        categoryId: input.incomeCategoryId,
        amount: amountPaid,
        occurredAt: sale.saleDate,
        method: input.method ?? 'CASH',
        description: `Payment for sale ${sale.reference}`,
        sourceType: 'SALE',
      })
      await tx.financeTransaction.update({
        where: { id: posted.id },
        data: { saleId: sale.id, buyerId: sale.buyerId },
      })
      paid = amountPaid
      paymentStatus = compare(paid, sale.total) >= 0 ? 'PAID' : 'PARTIAL'
    }

    await tx.sale.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        amountPaid: paid,
        paymentStatus,
      },
    })

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'sales.sale.confirmed',
        entityType: 'Sale',
        entityId: id,
        messageKey: 'audit.sales.confirmed',
        messageParams: { reference: sale.reference, total: toWire(sale.total) },
        before: { status: 'DRAFT' },
        after: { status: 'CONFIRMED', amountPaid: toWire(paid), paymentStatus },
      },
    )

    return sale.items.map((line) => line.productId)
  })

  // After the transaction, so no warning is written for a sale that rolled back.
  await reviewLowStock(ctx, productIds)
  return getSale(ctx, id)
}

/**
 * Cancelling a confirmed sale.
 *
 * Compensating movements, never deletions. A `SALE_RETURN` puts each line's stock back and the
 * income is reversed the way the finance module reverses anything, so both the sale and its undoing
 * stay in the history. A cooperative asked in six months why the June figures changed has to be
 * able to point at the answer.
 *
 * A draft is cancelled too, and then there is nothing to compensate for: nothing ever left.
 */
export async function cancelSale(
  ctx: RequestContext,
  id: string,
  reason: string,
): Promise<SaleDetail> {
  const cooperativeId = requireCooperativeId(ctx)

  const productIds = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id, cooperativeId },
      select: {
        id: true,
        reference: true,
        status: true,
        buyerId: true,
        warehouseId: true,
        saleDate: true,
        total: true,
        items: {
          select: {
            productId: true,
            quantity: true,
            unitId: true,
            product: { select: { trackInventory: true } },
          },
        },
      },
    })
    if (!sale) throw AppError.notFound()

    if (sale.status === 'CANCELLED') {
      throw AppError.conflict('errors.sales.alreadyCancelled', 'That sale is already cancelled.')
    }

    if (sale.status === 'CONFIRMED') {
      for (const line of sale.items) {
        if (!line.product.trackInventory) continue
        await increaseStock(
          tx,
          { cooperativeId, productId: line.productId, warehouseId: sale.warehouseId },
          line.quantity,
        )
        const reference = await nextInventoryReference(tx, cooperativeId, sale.saleDate)
        await tx.inventoryTransaction.create({
          data: {
            cooperativeId,
            reference,
            type: 'SALE_RETURN',
            direction: 'IN',
            productId: line.productId,
            warehouseId: sale.warehouseId,
            quantity: line.quantity,
            unitId: line.unitId,
            buyerId: sale.buyerId,
            saleId: sale.id,
            reason,
            occurredAt: sale.saleDate,
            createdById: ctx.user.id,
          },
        })
      }

      const payments = await tx.financeTransaction.findMany({
        where: { saleId: sale.id, kind: 'INCOME', status: 'POSTED', reversalOfId: null },
        select: { id: true },
      })
      for (const payment of payments) {
        await voidTransaction(tx, ctx, payment.id, `Sale ${sale.reference} cancelled: ${reason}`)
      }
    }

    await tx.sale.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason,
        amountPaid: ZERO,
        paymentStatus: 'UNPAID',
      },
    })

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'sales.sale.cancelled',
        entityType: 'Sale',
        entityId: id,
        messageKey: 'audit.sales.cancelled',
        messageParams: { reference: sale.reference, total: toWire(sale.total) },
        before: { status: sale.status },
        after: { status: 'CANCELLED', reason },
      },
    )

    return sale.items.map((line) => line.productId)
  })

  await reviewLowStock(ctx, productIds)
  return getSale(ctx, id)
}

/**
 * Records money received against a confirmed sale.
 *
 * `amountPaid` and `paymentStatus` on the sale are maintained from the income entries rather than
 * set by hand, so the two can never disagree: the figure is recomputed from what is actually
 * posted every time a payment is recorded.
 */
export async function recordSalePayment(
  ctx: RequestContext,
  id: string,
  input: RecordPaymentInput,
): Promise<SaleDetail> {
  const cooperativeId = requireCooperativeId(ctx)
  const amount = parseMoney(input.amount, { field: 'body.amount' })

  await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id, cooperativeId },
      select: {
        id: true,
        reference: true,
        status: true,
        buyerId: true,
        total: true,
        amountPaid: true,
      },
    })
    if (!sale) throw AppError.notFound()

    if (sale.status !== 'CONFIRMED') {
      throw AppError.conflict(
        'errors.sales.paymentNeedsConfirmed',
        'Payment is recorded against a confirmed sale. Confirm it first.',
      )
    }

    const owed = subtract(sale.total, sale.amountPaid)
    if (compare(amount, owed) > 0) {
      // Overpaying is a slip rather than a payment, and accepting it would leave the sale showing
      // more received than it was ever worth.
      throw AppError.validationFailed([
        { field: 'body.amount', messageKey: 'validation.paymentExceedsOutstanding' },
      ])
    }

    const posted = await postTransaction(tx, ctx, {
      kind: 'INCOME',
      categoryId: input.incomeCategoryId,
      amount,
      occurredAt: input.paidOn ? dayStart(input.paidOn) : new Date(),
      method: input.method,
      description: `Payment for sale ${sale.reference}${input.note ? `: ${input.note}` : ''}`,
      sourceType: 'SALE',
    })
    await tx.financeTransaction.update({
      where: { id: posted.id },
      data: { saleId: sale.id, buyerId: sale.buyerId },
    })

    // Recomputed from what is posted rather than added to the stored figure, so a reversal
    // somewhere else can never leave this out of step.
    const total = await tx.financeTransaction.aggregate({
      where: { saleId: sale.id, kind: 'INCOME', status: 'POSTED', reversalOfId: null },
      _sum: { amount: true },
    })
    const paid = total._sum.amount ?? ZERO
    const paymentStatus: PaymentStatus = paid.isZero()
      ? 'UNPAID'
      : compare(paid, sale.total) >= 0
        ? 'PAID'
        : 'PARTIAL'

    await tx.sale.update({ where: { id }, data: { amountPaid: paid, paymentStatus } })

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'sales.payment.recorded',
        entityType: 'Sale',
        entityId: id,
        messageKey: 'audit.sales.paymentRecorded',
        messageParams: {
          reference: sale.reference,
          amount: toWire(amount),
          entry: posted.reference,
        },
        before: { amountPaid: toWire(sale.amountPaid) },
        after: { amountPaid: toWire(paid), paymentStatus },
      },
    )
  })

  return getSale(ctx, id)
}

export async function listSales(
  ctx: RequestContext,
  query: ListSalesQuery,
): Promise<{
  items: SaleRow[]
  total: number
  totals: { sold: string; paid: string; outstanding: string }
}> {
  const cooperativeId = requireCooperativeId(ctx)
  const search = query.q?.trim()

  const where: Prisma.SaleWhereInput = {
    cooperativeId,
    ...(query.buyerId ? { buyerId: query.buyerId } : {}),
    ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(query.from || query.to
      ? {
          saleDate: {
            ...(query.from ? { gte: dayStart(query.from) } : {}),
            ...(query.to ? { lte: dayStart(query.to) } : {}),
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { reference: { contains: search, mode: 'insensitive' } },
            { buyer: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }

  const orderBy: Prisma.SaleOrderByWithRelationInput[] =
    query.sort === 'saleDate'
      ? [{ saleDate: 'asc' }, { reference: 'asc' }]
      : query.sort === 'total'
        ? [{ total: 'asc' }]
        : query.sort === '-total'
          ? [{ total: 'desc' }]
          : query.sort === 'reference'
            ? [{ reference: 'asc' }]
            : query.sort === '-reference'
              ? [{ reference: 'desc' }]
              : [{ saleDate: 'desc' }, { reference: 'desc' }]

  const [rows, total, confirmed] = await Promise.all([
    prisma.sale.findMany({
      where,
      select: SALE_SELECT,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.sale.count({ where }),
    // Only confirmed sales count towards a total. A draft is an intention and a cancelled sale is
    // business that was undone; counting either would overstate what the cooperative sold.
    prisma.sale.aggregate({
      where: { AND: [where, { status: 'CONFIRMED' }] },
      _sum: { total: true, amountPaid: true },
    }),
  ])

  const sold = confirmed._sum.total ?? ZERO
  const paid = confirmed._sum.amountPaid ?? ZERO

  return {
    items: rows.map(toSaleRow),
    total,
    totals: {
      sold: toWire(sold),
      paid: toWire(paid),
      outstanding: toWire(subtract(sold, paid)),
    },
  }
}

export interface SalesSummary {
  from: string
  to: string
  groupBy: string
  sold: string
  paid: string
  outstanding: string
  saleCount: number
  buckets: { start: string; sold: string; saleCount: number }[]
  topBuyers: { buyerId: string; name: string; sold: string; saleCount: number }[]
  topProducts: { productId: string; name: string; sku: string; quantity: string; sold: string }[]
}

/**
 * What was sold over a period, and to whom.
 *
 * Confirmed sales only, and the buckets are filled in for periods with no sales rather than
 * omitted, for the same reason the finance summary does it: a chart that skips an empty month
 * draws a line between two points that are not adjacent.
 */
export async function salesSummary(
  ctx: RequestContext,
  query: SalesSummaryQuery,
): Promise<SalesSummary> {
  const cooperativeId = requireCooperativeId(ctx)
  const from = dayStart(query.from)
  const to = dayStart(query.to)

  const where: Prisma.SaleWhereInput = {
    cooperativeId,
    status: 'CONFIRMED',
    saleDate: { gte: from, lte: to },
  }

  const [headline, byBucket, byBuyer, byProduct] = await Promise.all([
    prisma.sale.aggregate({
      where,
      _sum: { total: true, amountPaid: true },
      _count: { _all: true },
    }),
    prisma.$queryRaw<{ bucket: Date; sold: unknown; sales: bigint }[]>`
      SELECT date_trunc(${query.groupBy}, sale_date) AS bucket,
             sum(total) AS sold,
             count(*) AS sales
        FROM sales
       WHERE cooperative_id = ${cooperativeId}::uuid
         AND status = 'CONFIRMED'
         AND sale_date >= ${from}
         AND sale_date <= ${to}
       GROUP BY 1
       ORDER BY 1
    `,
    prisma.sale.groupBy({
      by: ['buyerId'],
      where,
      _sum: { total: true },
      _count: { _all: true },
      orderBy: { _sum: { total: 'desc' } },
      take: 10,
    }),
    prisma.$queryRaw<
      { product_id: string; name: string; sku: string; quantity: unknown; sold: unknown }[]
    >`
      SELECT i.product_id, p.name, p.sku,
             sum(i.quantity) AS quantity,
             sum(i.line_total) AS sold
        FROM sale_items i
        JOIN sales s ON s.id = i.sale_id
        JOIN products p ON p.id = i.product_id
       WHERE s.cooperative_id = ${cooperativeId}::uuid
         AND s.status = 'CONFIRMED'
         AND s.sale_date >= ${from}
         AND s.sale_date <= ${to}
       GROUP BY i.product_id, p.name, p.sku
       ORDER BY sold DESC
       LIMIT 10
    `,
  ])

  const bucketed = new Map(
    byBucket.map((row) => [
      row.bucket.toISOString().slice(0, 10),
      { sold: fromDatabase(row.sold), sales: Number(row.sales) },
    ]),
  )

  const buckets = bucketStarts(query.from, query.to, query.groupBy).map((start) => {
    const found = bucketed.get(start)
    return {
      start,
      sold: toWire(found?.sold ?? ZERO),
      saleCount: found?.sales ?? 0,
    }
  })

  const buyerIds = byBuyer.map((row) => row.buyerId)
  const buyers = await prisma.buyer.findMany({
    where: { id: { in: buyerIds } },
    select: { id: true, name: true },
  })
  const buyerNames = new Map(buyers.map((row) => [row.id, row.name]))

  const sold = headline._sum.total ?? ZERO
  const paid = headline._sum.amountPaid ?? ZERO

  return {
    from: query.from,
    to: query.to,
    groupBy: query.groupBy,
    sold: toWire(sold),
    paid: toWire(paid),
    outstanding: toWire(subtract(sold, paid)),
    saleCount: headline._count._all,
    buckets,
    topBuyers: byBuyer.map((row) => ({
      buyerId: row.buyerId,
      name: buyerNames.get(row.buyerId) ?? 'Unknown',
      sold: toWire(row._sum.total ?? ZERO),
      saleCount: row._count._all,
    })),
    topProducts: byProduct.map((row) => ({
      productId: row.product_id,
      name: row.name,
      sku: row.sku,
      quantity: toWire(fromDatabase(row.quantity), 3),
      sold: toWire(fromDatabase(row.sold)),
    })),
  }
}

/** Every bucket start in the range, including the empty ones. Walks UTC dates, as finance does. */
function bucketStarts(from: string, to: string, groupBy: 'day' | 'week' | 'month'): string[] {
  const end = dayStart(to)
  const starts: string[] = []
  let cursor = truncate(dayStart(from), groupBy)

  while (cursor <= end && starts.length < 2000) {
    starts.push(cursor.toISOString().slice(0, 10))
    cursor = advance(cursor, groupBy)
  }
  return starts
}

function truncate(date: Date, groupBy: 'day' | 'week' | 'month'): Date {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  if (groupBy === 'month') return new Date(Date.UTC(year, month, 1))
  if (groupBy === 'day') return new Date(Date.UTC(year, month, day))
  const weekday = date.getUTCDay()
  return new Date(Date.UTC(year, month, day - (weekday === 0 ? 6 : weekday - 1)))
}

function advance(date: Date, groupBy: 'day' | 'week' | 'month'): Date {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  if (groupBy === 'month') return new Date(Date.UTC(year, month + 1, 1))
  return new Date(Date.UTC(year, month, day + (groupBy === 'week' ? 7 : 1)))
}

export interface SaleReceipt {
  sale: SaleDetail
  cooperative: { name: string; code: string; district: string; sector: string }
  buyer: BuyerRow
  /** When the receipt was produced, so two copies of the same sale can be told apart. */
  issuedAt: string
  issuedBy: string
}

/**
 * Everything a receipt needs, in one request.
 *
 * The API does not render the receipt. A printable page belongs in the interface, where the
 * cooperative's own language and paper size apply; what the server owes is the figures, already
 * rounded and already strings, so that nothing in the printing path can arrive at a different
 * total from the one in the books.
 */
export async function saleReceipt(ctx: RequestContext, id: string): Promise<SaleReceipt> {
  const cooperativeId = requireCooperativeId(ctx)
  const sale = await getSale(ctx, id)
  const [cooperative, buyer] = await Promise.all([
    prisma.cooperative.findUniqueOrThrow({
      where: { id: cooperativeId },
      select: { name: true, code: true, district: true, sector: true },
    }),
    getBuyer(ctx, sale.buyerId),
  ])

  await writeAudit(
    { ctx },
    {
      action: 'sales.receipt.issued',
      entityType: 'Sale',
      entityId: id,
      messageKey: 'audit.sales.receiptIssued',
      messageParams: { reference: sale.reference },
    },
  )

  return {
    sale,
    cooperative,
    buyer,
    issuedAt: new Date().toISOString(),
    issuedBy: ctx.user.fullName,
  }
}
