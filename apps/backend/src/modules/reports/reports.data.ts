import {
  REPORTS,
  auditActionLabel,
  enumLabel,
  reportLabel,
  reportPeriodLabel,
  type Locale,
  type PermissionKey,
  type ReportColumn,
  type ReportDocument,
  type ReportFigure,
  type ReportRow,
  type ReportSection,
  type ReportType,
} from '@coopmanage/shared'
import type { Prisma } from '@prisma/client'
import { actorLabel, type RequestContext } from '../../lib/context.js'
import { AppError } from '../../lib/errors.js'
import { add, fromDatabase, subtract, toWire, ZERO, type Money } from '../../lib/money.js'
import { prisma } from '../../lib/prisma.js'
import { COUNTS_TOWARDS_TOTALS } from '../finance/finance.service.js'
import { salesSummary } from '../sales/sales.service.js'
import { dayBefore, endOfDay, kigaliDateTime, startOfDay } from './dates.js'
import type { ReportParams } from './reports.schemas.js'

/**
 * Where a report's content is decided.
 *
 * One function per report, each returning sections in the order they are printed. Nothing here
 * knows about PDFs, CSV files or HTML: the renderers walk the sections. That separation is what
 * lets the same report be read on a screen, printed to A4 and opened in a spreadsheet without
 * three chances to disagree about what the cooperative's money did last month.
 *
 * Three rules run through all of it.
 *
 * **Figures come from the same rule the screens use.** `COUNTS_TOWARDS_TOTALS` is imported from the
 * finance service rather than restated, so a voided entry and its reversal are excluded as a pair
 * here exactly as they are in the ledger. A report that disagreed with the screen it was produced
 * from would be worse than no report.
 *
 * **A section the reader may not see is named, not dropped.** Somebody printing the monthly report
 * without `finance:view` gets the membership and the stock and a line saying the money section was
 * withheld. A silently missing section is one a reader draws a conclusion from.
 *
 * **Nothing is rounded on the way out.** Money is read as `Decimal`, added with the decimal
 * library and written to the wire as a string at the last moment.
 */

/** A report is read, not a database dump. Beyond this a table says how many rows it stands for. */
const MAX_TABLE_ROWS = 400

type Section = ReportSection & { title: string }

interface Build {
  ctx: RequestContext
  cooperativeId: string
  locale: Locale
  currency: string
  params: ReportParams
  from: Date
  to: Date
  withheld: string[]
}

function t(build: Build, key: string, values: Record<string, string | number> = {}): string {
  return reportLabel(build.locale, key, values)
}

function can(build: Build, permission: PermissionKey): boolean {
  return build.ctx.permissions.has(permission)
}

/** A product's own name in the reader's language, where the cooperative gave it one. */
function localName(build: Build, name: string, nameRw: string | null): string {
  return build.locale === 'RW' && nameRw ? nameRw : name
}

function figures(build: Build, key: string, sectionKey: string, items: ReportFigure[]): Section {
  return { kind: 'figures', key, title: t(build, `section.${sectionKey}`), figures: items }
}

function table(
  build: Build,
  key: string,
  sectionKey: string,
  columns: ReportColumn[],
  rows: ReportRow[],
  options: { total?: ReportRow; truncatedFrom?: number } = {},
): Section {
  return {
    kind: 'table',
    key,
    title: t(build, `section.${sectionKey}`),
    columns,
    rows,
    emptyLabel: t(build, 'report.none'),
    ...options,
  }
}

function withheldSection(build: Build, key: string, sectionKey: string): Section {
  const section = t(build, `section.${sectionKey}`)
  build.withheld.push(section)
  return {
    kind: 'withheld',
    key,
    title: section,
    text: t(build, 'report.withheld', { section }),
  }
}

function money(value: Money): string {
  return toWire(value)
}

function count(value: number): string {
  return String(value)
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

async function membershipFigures(build: Build): Promise<ReportFigure[]> {
  const { cooperativeId, params } = build
  const [total, active, joined, withoutPhone] = await Promise.all([
    prisma.member.count({ where: { cooperativeId } }),
    prisma.member.count({ where: { cooperativeId, status: 'ACTIVE' } }),
    prisma.member.count({
      where: {
        cooperativeId,
        joinedOn: { gte: startOfDay(params.from), lte: endOfDay(params.to) },
      },
    }),
    // Not a defect to be fixed: a phone number is never required of a member. It is printed
    // because it tells the committee how many members an SMS cannot reach, which is what decides
    // whether a meeting is called by telephone or by word of mouth.
    prisma.member.count({ where: { cooperativeId, status: 'ACTIVE', phone: null } }),
  ])

  return [
    { key: 'total', label: t(build, 'figure.members.total'), type: 'number', value: count(total) },
    {
      key: 'active',
      label: t(build, 'figure.members.active'),
      type: 'number',
      value: count(active),
    },
    {
      key: 'joined',
      label: t(build, 'figure.members.joined'),
      type: 'number',
      value: count(joined),
    },
    {
      key: 'withoutPhone',
      label: t(build, 'figure.members.withoutPhone'),
      type: 'number',
      value: count(withoutPhone),
    },
  ]
}

async function registerTable(build: Build): Promise<Section> {
  const rows = await prisma.member.findMany({
    where: { cooperativeId: build.cooperativeId },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    take: MAX_TABLE_ROWS + 1,
    select: {
      memberCode: true,
      firstName: true,
      lastName: true,
      phone: true,
      position: true,
      status: true,
      joinedOn: true,
    },
  })

  const truncated = rows.length > MAX_TABLE_ROWS
  const shown = truncated ? rows.slice(0, MAX_TABLE_ROWS) : rows

  return table(
    build,
    'register',
    'register',
    [
      { key: 'code', label: t(build, 'column.memberCode'), type: 'text', weight: 1 },
      { key: 'name', label: t(build, 'column.member'), type: 'text', weight: 3 },
      { key: 'phone', label: t(build, 'column.phone'), type: 'text', weight: 1.4 },
      { key: 'position', label: t(build, 'column.position'), type: 'text', weight: 1.4 },
      { key: 'status', label: t(build, 'column.status'), type: 'text', weight: 1.4 },
      { key: 'joinedOn', label: t(build, 'column.joinedOn'), type: 'date', weight: 1.6 },
    ],
    shown.map((row) => ({
      code: row.memberCode,
      name: `${row.lastName} ${row.firstName}`,
      // A member without a telephone is the ordinary case, not a gap to be marked.
      phone: row.phone,
      position: enumLabel(build.locale, 'memberPosition', row.position),
      status: enumLabel(build.locale, 'memberStatus', row.status),
      joinedOn: row.joinedOn.toISOString().slice(0, 10),
    })),
    truncated
      ? {
          truncatedFrom: await prisma.member.count({
            where: { cooperativeId: build.cooperativeId },
          }),
        }
      : {},
  )
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

function financeWhere(build: Build, extra: Prisma.FinanceTransactionWhereInput = {}) {
  return {
    cooperativeId: build.cooperativeId,
    ...COUNTS_TOWARDS_TOTALS,
    ...(build.params.categoryId ? { categoryId: build.params.categoryId } : {}),
    ...extra,
  } satisfies Prisma.FinanceTransactionWhereInput
}

async function sumFinance(
  build: Build,
  kind: 'INCOME' | 'EXPENSE',
  window: Prisma.DateTimeFilter | undefined,
): Promise<Money> {
  const result = await prisma.financeTransaction.aggregate({
    where: financeWhere(build, { kind, ...(window ? { occurredAt: window } : {}) }),
    _sum: { amount: true },
  })
  return fromDatabase(result._sum.amount)
}

interface FinanceTotals {
  opening: Money
  income: Money
  expenses: Money
  net: Money
  closing: Money
}

/**
 * The five figures a treasurer is asked for at a meeting.
 *
 * The opening balance is everything that happened before the period, not a stored number. A stored
 * balance would have to be kept in step with every void and every reversal for the rest of the
 * cooperative's life; recomputing it means a correction made today shows up correctly in a report
 * for last March, which is the behaviour a cooperative's auditor expects.
 */
async function financeTotalsFor(build: Build): Promise<FinanceTotals> {
  const before = { lte: endOfDay(dayBefore(build.params.from)) }
  const period = { gte: startOfDay(build.params.from), lte: endOfDay(build.params.to) }

  const [openingIn, openingOut, income, expenses] = await Promise.all([
    sumFinance(build, 'INCOME', before),
    sumFinance(build, 'EXPENSE', before),
    sumFinance(build, 'INCOME', period),
    sumFinance(build, 'EXPENSE', period),
  ])

  const opening = subtract(openingIn, openingOut)
  const net = subtract(income, expenses)
  return { opening, income, expenses, net, closing: add(opening, net) }
}

function financeFigures(build: Build, totals: FinanceTotals): ReportFigure[] {
  return [
    {
      key: 'opening',
      label: t(build, 'figure.finance.opening'),
      type: 'money',
      value: money(totals.opening),
    },
    {
      key: 'income',
      label: t(build, 'figure.finance.income'),
      type: 'money',
      value: money(totals.income),
    },
    {
      key: 'expenses',
      label: t(build, 'figure.finance.expenses'),
      type: 'money',
      value: money(totals.expenses),
    },
    { key: 'net', label: t(build, 'figure.finance.net'), type: 'money', value: money(totals.net) },
    {
      key: 'closing',
      label: t(build, 'figure.finance.closing'),
      type: 'money',
      value: money(totals.closing),
    },
  ]
}

async function financeCategoryTable(build: Build): Promise<Section> {
  const period = { gte: startOfDay(build.params.from), lte: endOfDay(build.params.to) }
  const grouped = await prisma.financeTransaction.groupBy({
    by: ['categoryId', 'kind'],
    where: financeWhere(build, { occurredAt: period }),
    _sum: { amount: true },
    _count: { _all: true },
  })

  const categories = await prisma.financeCategory.findMany({
    where: { cooperativeId: build.cooperativeId, id: { in: grouped.map((row) => row.categoryId) } },
    select: { id: true, name: true, nameRw: true },
  })
  const named = new Map(categories.map((row) => [row.id, localName(build, row.name, row.nameRw)]))

  const rows = grouped
    .map((row) => ({
      category: named.get(row.categoryId) ?? '',
      kind: enumLabel(build.locale, 'financeKind', row.kind),
      sortKind: row.kind,
      count: count(row._count._all),
      amount: money(fromDatabase(row._sum.amount)),
    }))
    .sort(
      (a, b) =>
        a.sortKind.localeCompare(b.sortKind) ||
        Number(b.amount) - Number(a.amount) ||
        a.category.localeCompare(b.category),
    )
    .map(({ sortKind: _sortKind, ...row }) => row)

  return table(
    build,
    'categories',
    'categories',
    [
      { key: 'kind', label: t(build, 'column.kind'), type: 'text', weight: 1.4 },
      { key: 'category', label: t(build, 'column.category'), type: 'text', weight: 3 },
      { key: 'count', label: t(build, 'column.count'), type: 'number', weight: 1 },
      { key: 'amount', label: t(build, 'column.amount'), type: 'money', weight: 1.8 },
    ],
    rows,
  )
}

/**
 * Every entry of the period, as a printed ledger.
 *
 * Money out is written as a negative amount rather than in a separate "kind" column. Three reasons,
 * and the third is the one that decided it. It is what the ledger screen already does — the `Money`
 * component prefixes a minus for an expense — so the paper and the screen read alike. A column of
 * signed amounts adds up to the period's difference, which is what somebody with a calculator
 * checks. And the kind column was redundant: every category belongs to one kind, so it repeated the
 * category beside it while costing a fifth of the width of an A4 page. In Kinyarwanda it cost more
 * than that, because "Amafaranga yasohotse" wrapped onto two lines on every single row.
 */
async function financeEntriesTable(build: Build): Promise<Section> {
  const period = { gte: startOfDay(build.params.from), lte: endOfDay(build.params.to) }
  const where = financeWhere(build, { occurredAt: period })

  const [rows, total] = await Promise.all([
    prisma.financeTransaction.findMany({
      where,
      orderBy: [{ occurredAt: 'asc' }, { reference: 'asc' }],
      take: MAX_TABLE_ROWS,
      select: {
        reference: true,
        occurredAt: true,
        kind: true,
        amount: true,
        method: true,
        description: true,
        category: { select: { name: true, nameRw: true } },
      },
    }),
    prisma.financeTransaction.count({ where }),
  ])

  const signed = (kind: 'INCOME' | 'EXPENSE', amount: Money): Money =>
    kind === 'EXPENSE' ? subtract(ZERO, amount) : amount

  const sum = rows.reduce<Money>(
    (running, row) => add(running, signed(row.kind, fromDatabase(row.amount))),
    ZERO,
  )

  return table(
    build,
    'entries',
    'entries',
    [
      { key: 'date', label: t(build, 'column.date'), type: 'date', weight: 1.6 },
      { key: 'reference', label: t(build, 'column.reference'), type: 'text', weight: 1.6 },
      { key: 'category', label: t(build, 'column.category'), type: 'text', weight: 2.4 },
      { key: 'method', label: t(build, 'column.method'), type: 'text', weight: 1.8 },
      { key: 'description', label: t(build, 'column.description'), type: 'text', weight: 3.6 },
      { key: 'amount', label: t(build, 'column.amount'), type: 'money', weight: 1.8 },
    ],
    rows.map((row) => ({
      date: row.occurredAt.toISOString().slice(0, 10),
      reference: row.reference,
      category: localName(build, row.category.name, row.category.nameRw),
      method: enumLabel(build.locale, 'paymentMethod', row.method),
      description: row.description,
      amount: money(signed(row.kind, fromDatabase(row.amount))),
    })),
    {
      // The totals row sums what is printed, and the note below it says so when the table was cut
      // short. A total that quietly covered rows the reader cannot see would be the worst of both.
      total: {
        date: null,
        reference: null,
        category: null,
        method: null,
        description: t(build, 'total.label'),
        amount: money(sum),
      },
      ...(total > rows.length ? { truncatedFrom: total } : {}),
    },
  )
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

function stockWhere(build: Build) {
  return {
    cooperativeId: build.cooperativeId,
    ...(build.params.warehouseId ? { warehouseId: build.params.warehouseId } : {}),
  }
}

interface StockHolding {
  productId: string
  name: string
  sku: string
  unit: string
  warehouse: string
  quantity: Money
  minimum: Money | null
  unitCost: Money | null
}

async function stockHoldings(build: Build): Promise<StockHolding[]> {
  const levels = await prisma.stockLevel.findMany({
    where: stockWhere(build),
    orderBy: [{ product: { name: 'asc' } }, { warehouse: { name: 'asc' } }],
    select: {
      productId: true,
      quantity: true,
      warehouse: { select: { name: true } },
      product: {
        select: {
          name: true,
          nameRw: true,
          sku: true,
          minStockLevel: true,
          defaultPurchasePrice: true,
          unit: { select: { symbol: true } },
        },
      },
    },
  })

  return levels.map((row) => ({
    productId: row.productId,
    name: localName(build, row.product.name, row.product.nameRw),
    sku: row.product.sku,
    unit: row.product.unit.symbol,
    warehouse: row.warehouse.name,
    quantity: fromDatabase(row.quantity),
    minimum: row.product.minStockLevel === null ? null : fromDatabase(row.product.minStockLevel),
    unitCost:
      row.product.defaultPurchasePrice === null
        ? null
        : fromDatabase(row.product.defaultPurchasePrice),
  }))
}

/**
 * What the stock is worth, at the purchase price the cooperative recorded for each product.
 *
 * A product with no recorded purchase price contributes nothing and is counted separately, so the
 * figure is never quietly wrong: the report says how many products it could not value rather than
 * printing a total that looks complete. Valuing stock is a money question, so the figure is gated
 * on `finance:view` even inside a stock report.
 */
function valuationOf(holdings: StockHolding[]): { value: Money; unpriced: number } {
  let value = ZERO
  let unpriced = 0
  for (const holding of holdings) {
    if (holding.unitCost === null) {
      if (!holding.quantity.isZero()) unpriced += 1
      continue
    }
    value = add(value, holding.quantity.mul(holding.unitCost))
  }
  return { value, unpriced }
}

async function movementTotals(build: Build): Promise<{ received: Money; issued: Money }> {
  const period = { gte: startOfDay(build.params.from), lte: endOfDay(build.params.to) }
  const grouped = await prisma.inventoryTransaction.groupBy({
    by: ['direction'],
    where: { ...stockWhere(build), occurredAt: period, reversalOfId: null },
    _sum: { quantity: true },
  })
  const find = (direction: 'IN' | 'OUT') =>
    fromDatabase(grouped.find((row) => row.direction === direction)?._sum.quantity)
  return { received: find('IN'), issued: find('OUT') }
}

async function stockFigures(build: Build, holdings: StockHolding[]): Promise<ReportFigure[]> {
  const movements = await movementTotals(build)
  const lowCount = countLow(build, holdings)

  const items: ReportFigure[] = [
    {
      key: 'products',
      label: t(build, 'figure.inventory.products'),
      type: 'number',
      value: count(new Set(holdings.map((row) => row.productId)).size),
    },
    {
      key: 'low',
      label: t(build, 'figure.inventory.low'),
      type: 'number',
      value: count(lowCount),
    },
    {
      key: 'received',
      label: t(build, 'figure.inventory.received'),
      type: 'quantity',
      value: toWire(movements.received, 3),
    },
    {
      key: 'issued',
      label: t(build, 'figure.inventory.issued'),
      type: 'quantity',
      value: toWire(movements.issued, 3),
    },
  ]

  if (can(build, 'finance:view')) {
    const { value, unpriced } = valuationOf(holdings)
    items.push({
      key: 'value',
      label: t(build, 'figure.inventory.value'),
      type: 'money',
      value: money(value),
      ...(unpriced > 0 ? { hint: t(build, 'report.unpriced', { count: unpriced }) } : {}),
    })
  }

  return items
}

/**
 * How many products are at or below their minimum.
 *
 * Counted per product across every store, not per stock row. A cooperative with fertiliser in the
 * second store has not run out, and a report that said otherwise would teach the committee to
 * ignore the figure — the same rule the low-stock watch follows, and the disagreement between the
 * two that had to be fixed in Phase 6.
 */
function countLow(build: Build, holdings: StockHolding[]): number {
  const byProduct = new Map<string, { quantity: Money; minimum: Money | null }>()
  for (const holding of holdings) {
    const running = byProduct.get(holding.productId)
    byProduct.set(holding.productId, {
      quantity: running ? add(running.quantity, holding.quantity) : holding.quantity,
      minimum: holding.minimum,
    })
  }
  let low = 0
  for (const row of byProduct.values()) {
    if (row.minimum !== null && row.quantity.lte(row.minimum)) low += 1
  }
  return low
}

function stockTable(build: Build, holdings: StockHolding[]): Section {
  const withValue = can(build, 'finance:view')
  const columns: ReportColumn[] = [
    { key: 'sku', label: t(build, 'column.sku'), type: 'text', weight: 1.2 },
    { key: 'product', label: t(build, 'column.product'), type: 'text', weight: 3 },
    { key: 'warehouse', label: t(build, 'column.warehouse'), type: 'text', weight: 1.8 },
    { key: 'quantity', label: t(build, 'column.quantity'), type: 'quantity', weight: 1.4 },
    { key: 'unit', label: t(build, 'column.unit'), type: 'text', weight: 0.8, align: 'left' },
    { key: 'minimum', label: t(build, 'column.minimum'), type: 'quantity', weight: 1.2 },
  ]
  if (withValue) {
    columns.push({
      key: 'unitCost',
      label: t(build, 'column.unitCost'),
      type: 'money',
      weight: 1.4,
    })
    columns.push({ key: 'value', label: t(build, 'column.value'), type: 'money', weight: 1.6 })
  }

  const shown = holdings.slice(0, MAX_TABLE_ROWS)
  const rows: ReportRow[] = shown.map((row) => ({
    sku: row.sku,
    product: row.name,
    warehouse: row.warehouse,
    quantity: toWire(row.quantity, 3),
    unit: row.unit,
    minimum: row.minimum === null ? null : toWire(row.minimum, 3),
    ...(withValue
      ? {
          unitCost: row.unitCost === null ? null : money(row.unitCost),
          value: row.unitCost === null ? null : money(row.quantity.mul(row.unitCost)),
        }
      : {}),
  }))

  return table(build, 'holdings', 'inventory', columns, rows, {
    ...(withValue
      ? {
          total: {
            sku: null,
            product: t(build, 'total.label'),
            warehouse: null,
            quantity: null,
            unit: null,
            minimum: null,
            unitCost: null,
            value: money(valuationOf(shown).value),
          },
        }
      : {}),
    ...(holdings.length > shown.length ? { truncatedFrom: holdings.length } : {}),
  })
}

function lowStockTable(build: Build, holdings: StockHolding[]): Section {
  const byProduct = new Map<string, StockHolding & { quantity: Money }>()
  for (const holding of holdings) {
    const running = byProduct.get(holding.productId)
    byProduct.set(holding.productId, {
      ...holding,
      quantity: running ? add(running.quantity, holding.quantity) : holding.quantity,
    })
  }

  const rows = [...byProduct.values()]
    .filter((row) => row.minimum !== null && row.quantity.lte(row.minimum))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => ({
      sku: row.sku,
      product: row.name,
      quantity: toWire(row.quantity, 3),
      unit: row.unit,
      minimum: row.minimum === null ? null : toWire(row.minimum, 3),
    }))

  return table(
    build,
    'lowStock',
    'lowStock',
    [
      { key: 'sku', label: t(build, 'column.sku'), type: 'text', weight: 1.2 },
      { key: 'product', label: t(build, 'column.product'), type: 'text', weight: 3.4 },
      { key: 'quantity', label: t(build, 'column.quantity'), type: 'quantity', weight: 1.4 },
      { key: 'unit', label: t(build, 'column.unit'), type: 'text', weight: 0.8, align: 'left' },
      { key: 'minimum', label: t(build, 'column.minimum'), type: 'quantity', weight: 1.4 },
    ],
    rows,
  )
}

async function movementsTable(build: Build): Promise<Section> {
  const period = { gte: startOfDay(build.params.from), lte: endOfDay(build.params.to) }
  const where = { ...stockWhere(build), occurredAt: period }

  const [rows, total] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where,
      orderBy: [{ occurredAt: 'asc' }, { reference: 'asc' }],
      take: MAX_TABLE_ROWS,
      select: {
        reference: true,
        occurredAt: true,
        type: true,
        direction: true,
        quantity: true,
        product: { select: { name: true, nameRw: true, sku: true } },
        warehouse: { select: { name: true } },
        unit: { select: { symbol: true } },
      },
    }),
    prisma.inventoryTransaction.count({ where }),
  ])

  return table(
    build,
    'movements',
    'movements',
    [
      { key: 'date', label: t(build, 'column.date'), type: 'date', weight: 1.6 },
      { key: 'reference', label: t(build, 'column.reference'), type: 'text', weight: 1.8 },
      { key: 'kind', label: t(build, 'column.kind'), type: 'text', weight: 1.8 },
      { key: 'product', label: t(build, 'column.product'), type: 'text', weight: 2.8 },
      { key: 'warehouse', label: t(build, 'column.warehouse'), type: 'text', weight: 1.8 },
      { key: 'quantity', label: t(build, 'column.quantity'), type: 'quantity', weight: 1.4 },
      { key: 'unit', label: t(build, 'column.unit'), type: 'text', weight: 0.8, align: 'left' },
    ],
    rows.map((row) => ({
      date: row.occurredAt.toISOString().slice(0, 10),
      reference: row.reference,
      kind: enumLabel(build.locale, 'inventoryType', row.type),
      product: localName(build, row.product.name, row.product.nameRw),
      warehouse: row.warehouse.name,
      // Written with its sign, so a column of movements adds up to what the store did.
      quantity: `${row.direction === 'OUT' ? '-' : ''}${toWire(fromDatabase(row.quantity), 3)}`,
      unit: row.unit.symbol,
    })),
    total > rows.length ? { truncatedFrom: total } : {},
  )
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

/**
 * The sales figures come from the sales service's own summary rather than from queries written
 * again here. The screen and the report then cannot disagree about what was sold in a month, which
 * is worth more than the small amount of work the summary does that a report does not need.
 */
async function salesSections(build: Build, options: { detail: boolean }): Promise<Section[]> {
  const summary = await salesSummary(build.ctx, {
    from: build.params.from,
    to: build.params.to,
    groupBy: 'month',
  })

  const sections: Section[] = [
    figures(build, 'sales', 'sales', [
      {
        key: 'count',
        label: t(build, 'figure.sales.count'),
        type: 'number',
        value: count(summary.saleCount),
      },
      { key: 'sold', label: t(build, 'figure.sales.sold'), type: 'money', value: summary.sold },
      { key: 'paid', label: t(build, 'figure.sales.paid'), type: 'money', value: summary.paid },
      {
        key: 'outstanding',
        label: t(build, 'figure.sales.outstanding'),
        type: 'money',
        value: summary.outstanding,
      },
    ]),
    table(
      build,
      'topProducts',
      'topProducts',
      [
        { key: 'sku', label: t(build, 'column.sku'), type: 'text', weight: 1.2 },
        { key: 'product', label: t(build, 'column.product'), type: 'text', weight: 3.4 },
        { key: 'quantity', label: t(build, 'column.quantity'), type: 'quantity', weight: 1.4 },
        { key: 'sold', label: t(build, 'column.total'), type: 'money', weight: 1.8 },
      ],
      summary.topProducts.map((row) => ({
        sku: row.sku,
        product: localName(build, row.name, row.nameRw),
        quantity: row.quantity,
        sold: row.sold,
      })),
    ),
  ]

  if (!options.detail) return sections

  sections.push(
    table(
      build,
      'topBuyers',
      'topBuyers',
      [
        { key: 'buyer', label: t(build, 'column.buyer'), type: 'text', weight: 3.4 },
        { key: 'sales', label: t(build, 'column.sales'), type: 'number', weight: 1.2 },
        { key: 'sold', label: t(build, 'column.total'), type: 'money', weight: 1.8 },
      ],
      summary.topBuyers.map((row) => ({
        buyer: row.name,
        sales: count(row.saleCount),
        sold: row.sold,
      })),
    ),
  )

  const where: Prisma.SaleWhereInput = {
    cooperativeId: build.cooperativeId,
    saleDate: { gte: startOfDay(build.params.from), lte: endOfDay(build.params.to) },
    ...(build.params.warehouseId ? { warehouseId: build.params.warehouseId } : {}),
  }

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      orderBy: [{ saleDate: 'asc' }, { reference: 'asc' }],
      take: MAX_TABLE_ROWS,
      select: {
        reference: true,
        saleDate: true,
        status: true,
        paymentStatus: true,
        total: true,
        amountPaid: true,
        buyer: { select: { name: true } },
        warehouse: { select: { name: true } },
      },
    }),
    prisma.sale.count({ where }),
  ])

  sections.push(
    table(
      build,
      'entries',
      'entries',
      [
        { key: 'date', label: t(build, 'column.date'), type: 'date', weight: 1.6 },
        { key: 'reference', label: t(build, 'column.reference'), type: 'text', weight: 1.8 },
        { key: 'buyer', label: t(build, 'column.buyer'), type: 'text', weight: 2.8 },
        { key: 'warehouse', label: t(build, 'column.warehouse'), type: 'text', weight: 1.8 },
        { key: 'status', label: t(build, 'column.status'), type: 'text', weight: 1.6 },
        { key: 'total', label: t(build, 'column.total'), type: 'money', weight: 1.6 },
        { key: 'paid', label: t(build, 'column.paid'), type: 'money', weight: 1.6 },
        { key: 'outstanding', label: t(build, 'column.outstanding'), type: 'money', weight: 1.6 },
      ],
      sales.map((row) => {
        const value = fromDatabase(row.total)
        const paid = fromDatabase(row.amountPaid)
        // A cancelled sale owes nothing: its stock went back and its payments were reversed, so
        // printing its value as outstanding would invent a debt the buyer does not have.
        const outstanding = row.status === 'CANCELLED' ? ZERO : subtract(value, paid)
        return {
          date: row.saleDate.toISOString().slice(0, 10),
          reference: row.reference,
          buyer: row.buyer.name,
          warehouse: row.warehouse.name,
          status: enumLabel(build.locale, 'saleStatus', row.status),
          total: money(value),
          paid: money(paid),
          outstanding: money(outstanding),
        }
      }),
      total > sales.length ? { truncatedFrom: total } : {},
    ),
  )

  return sections
}

// ---------------------------------------------------------------------------
// One member
// ---------------------------------------------------------------------------

async function memberSections(
  build: Build,
  memberId: string,
): Promise<{
  sections: Section[]
  subtitle: string
}> {
  const member = await prisma.member.findFirst({
    where: { id: memberId, cooperativeId: build.cooperativeId },
    select: {
      memberCode: true,
      firstName: true,
      lastName: true,
      phone: true,
      position: true,
      status: true,
      joinedOn: true,
      district: true,
      sector: true,
    },
  })
  // A member of another cooperative is not found rather than refused, which is the rule the whole
  // application follows: a wrong tenant learns nothing about what exists elsewhere.
  if (!member) throw AppError.notFound()

  const period = { gte: startOfDay(build.params.from), lte: endOfDay(build.params.to) }
  const sections: Section[] = [
    figures(build, 'member', 'members', [
      {
        key: 'code',
        label: t(build, 'column.memberCode'),
        type: 'text',
        value: member.memberCode,
      },
      {
        key: 'position',
        label: t(build, 'column.position'),
        type: 'text',
        value: enumLabel(build.locale, 'memberPosition', member.position),
      },
      {
        key: 'status',
        label: t(build, 'column.status'),
        type: 'text',
        value: enumLabel(build.locale, 'memberStatus', member.status),
      },
      {
        key: 'joinedOn',
        label: t(build, 'column.joinedOn'),
        type: 'date',
        value: member.joinedOn.toISOString().slice(0, 10),
      },
    ]),
  ]

  if (can(build, 'contributions:view')) {
    const rows = await prisma.contribution.findMany({
      where: { cooperativeId: build.cooperativeId, memberId, paidOn: period, status: 'POSTED' },
      orderBy: [{ paidOn: 'asc' }],
      take: MAX_TABLE_ROWS,
      select: { paidOn: true, type: true, amount: true, method: true, reference: true },
    })
    const total = rows.reduce<Money>((running, row) => add(running, fromDatabase(row.amount)), ZERO)

    sections.push(
      figures(build, 'contributionTotals', 'contributions', [
        {
          key: 'count',
          label: t(build, 'figure.contributions.count'),
          type: 'number',
          value: count(rows.length),
        },
        {
          key: 'total',
          label: t(build, 'figure.contributions.total'),
          type: 'money',
          value: money(total),
        },
      ]),
      table(
        build,
        'contributions',
        'contributions',
        [
          { key: 'date', label: t(build, 'column.date'), type: 'date', weight: 1.6 },
          { key: 'kind', label: t(build, 'column.kind'), type: 'text', weight: 2.4 },
          { key: 'method', label: t(build, 'column.method'), type: 'text', weight: 2 },
          { key: 'reference', label: t(build, 'column.reference'), type: 'text', weight: 2 },
          { key: 'amount', label: t(build, 'column.amount'), type: 'money', weight: 1.8 },
        ],
        rows.map((row) => ({
          date: row.paidOn.toISOString().slice(0, 10),
          kind: enumLabel(build.locale, 'contributionType', row.type),
          method: enumLabel(build.locale, 'paymentMethod', row.method),
          reference: row.reference,
          amount: money(fromDatabase(row.amount)),
        })),
        {
          total: {
            date: null,
            kind: null,
            method: null,
            reference: t(build, 'total.label'),
            amount: money(total),
          },
        },
      ),
    )
  } else {
    sections.push(withheldSection(build, 'contributions', 'contributions'))
  }

  if (can(build, 'shares:view')) {
    // Shares are a holding rather than a period figure: what a member holds today is the number
    // read out at an assembly, so it counts every posted movement rather than only this period's.
    const movements = await prisma.memberShare.findMany({
      where: { cooperativeId: build.cooperativeId, memberId, status: 'POSTED' },
      orderBy: [{ issuedOn: 'asc' }],
      select: { issuedOn: true, type: true, quantity: true, unitValue: true, totalValue: true },
    })

    let quantity = 0
    let value = ZERO
    for (const row of movements) {
      const sign = row.type === 'PURCHASE' || row.type === 'TRANSFER_IN' ? 1 : -1
      quantity += sign * row.quantity
      value =
        sign === 1
          ? add(value, fromDatabase(row.totalValue))
          : subtract(value, fromDatabase(row.totalValue))
    }

    const inPeriod = movements.filter((row) => {
      const iso = row.issuedOn.toISOString().slice(0, 10)
      return iso >= build.params.from && iso <= build.params.to
    })

    sections.push(
      figures(build, 'shareTotals', 'shares', [
        {
          key: 'quantity',
          label: t(build, 'figure.shares.quantity'),
          type: 'number',
          value: count(quantity),
        },
        {
          key: 'value',
          label: t(build, 'figure.shares.value'),
          type: 'money',
          value: money(value),
        },
      ]),
      table(
        build,
        'shares',
        'shares',
        [
          { key: 'date', label: t(build, 'column.date'), type: 'date', weight: 1.6 },
          { key: 'kind', label: t(build, 'column.kind'), type: 'text', weight: 2.2 },
          { key: 'quantity', label: t(build, 'column.share'), type: 'number', weight: 1.2 },
          { key: 'unitValue', label: t(build, 'column.unitCost'), type: 'money', weight: 1.6 },
          { key: 'value', label: t(build, 'column.value'), type: 'money', weight: 1.8 },
        ],
        inPeriod.map((row) => ({
          date: row.issuedOn.toISOString().slice(0, 10),
          kind: enumLabel(build.locale, 'shareType', row.type),
          quantity: count(row.quantity),
          unitValue: money(fromDatabase(row.unitValue)),
          value: money(fromDatabase(row.totalValue)),
        })),
      ),
    )
  } else {
    sections.push(withheldSection(build, 'shares', 'shares'))
  }

  return {
    sections,
    subtitle: `${member.lastName} ${member.firstName} · ${member.memberCode}`,
  }
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

/** The few parameters worth printing next to an action, in the order they read best. */
const DETAIL_KEYS = ['reference', 'name', 'member', 'product', 'code', 'category', 'buyer'] as const

function detailOf(params: unknown): string | null {
  if (params === null || typeof params !== 'object') return null
  const record = params as Record<string, unknown>
  const parts: string[] = []
  for (const key of DETAIL_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) parts.push(value)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

async function activityTable(build: Build): Promise<Section> {
  const where: Prisma.AuditLogWhereInput = {
    cooperativeId: build.cooperativeId,
    createdAt: { gte: startOfDay(build.params.from), lte: endOfDay(build.params.to) },
  }

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: MAX_TABLE_ROWS,
      select: {
        createdAt: true,
        actorLabel: true,
        action: true,
        messageParams: true,
      },
    }),
    prisma.auditLog.count({ where }),
  ])

  return table(
    build,
    'activity',
    'activity',
    [
      { key: 'date', label: t(build, 'column.date'), type: 'date', weight: 1.6 },
      { key: 'who', label: t(build, 'column.who'), type: 'text', weight: 3 },
      { key: 'what', label: t(build, 'column.what'), type: 'text', weight: 3 },
      { key: 'detail', label: t(build, 'column.detail'), type: 'text', weight: 3 },
    ],
    rows.map((row) => ({
      date: row.createdAt.toISOString().slice(0, 10),
      who: row.actorLabel,
      // In words, never as `finance.transaction.voided`: this page is filed and read by auditors.
      what: auditActionLabel(build.locale, row.action),
      detail: detailOf(row.messageParams),
    })),
    total > rows.length ? { truncatedFrom: total } : {},
  )
}

// ---------------------------------------------------------------------------
// The seven reports
// ---------------------------------------------------------------------------

/**
 * How many rows a run covered, recorded against the `ReportRun` so a list of past runs is legible
 * without producing each one again.
 */
function rowsIn(sections: Section[]): number {
  return sections.reduce(
    (running, section) => running + (section.kind === 'table' ? section.rows.length : 0),
    0,
  )
}

/**
 * The monthly cooperative report: what a committee reads out at a general assembly.
 *
 * It is assembled from every module and each part is gated by the permission covering that part's
 * own data, so a secretary without `finance:view` gets the membership, the stock and the sales,
 * and a line saying the money section was withheld. That is the report the exit criterion for this
 * phase names, and the reason the section order is fixed: membership, money, stock, sales — the
 * order a Rwandan cooperative's agenda follows.
 */
async function monthlyCooperative(build: Build): Promise<Section[]> {
  const sections: Section[] = []

  if (can(build, 'members:view')) {
    sections.push(figures(build, 'members', 'members', await membershipFigures(build)))
  } else {
    sections.push(withheldSection(build, 'members', 'members'))
  }

  if (can(build, 'finance:view')) {
    sections.push(
      figures(build, 'finance', 'finance', financeFigures(build, await financeTotalsFor(build))),
    )
    sections.push(await financeCategoryTable(build))
  } else {
    sections.push(withheldSection(build, 'finance', 'finance'))
  }

  if (can(build, 'inventory:view')) {
    const holdings = await stockHoldings(build)
    sections.push(figures(build, 'inventory', 'inventory', await stockFigures(build, holdings)))
    sections.push(lowStockTable(build, holdings))
  } else {
    sections.push(withheldSection(build, 'inventory', 'inventory'))
  }

  if (can(build, 'sales:view')) {
    sections.push(...(await salesSections(build, { detail: false })))
  } else {
    sections.push(withheldSection(build, 'sales', 'sales'))
  }

  return sections
}

async function financialReport(build: Build): Promise<Section[]> {
  const totals = await financeTotalsFor(build)
  return [
    figures(build, 'finance', 'finance', financeFigures(build, totals)),
    await financeCategoryTable(build),
    await financeEntriesTable(build),
  ]
}

async function memberReport(build: Build): Promise<{ sections: Section[]; subtitle?: string }> {
  if (build.params.memberId) return memberSections(build, build.params.memberId)
  return {
    sections: [
      figures(build, 'members', 'members', await membershipFigures(build)),
      await registerTable(build),
    ],
  }
}

async function inventoryReport(build: Build): Promise<Section[]> {
  const holdings = await stockHoldings(build)
  return [
    figures(build, 'inventory', 'inventory', await stockFigures(build, holdings)),
    stockTable(build, holdings),
    lowStockTable(build, holdings),
    await movementsTable(build),
  ]
}

async function salesReport(build: Build): Promise<Section[]> {
  return salesSections(build, { detail: true })
}

async function activityReport(build: Build): Promise<Section[]> {
  return [await activityTable(build)]
}

/**
 * The minutes report: what the cooperative met about, decided, and still owes itself.
 *
 * Built around the two questions a general assembly is asked about its own meetings. Could each
 * meeting decide what it decided — which is quorum, counted from attendance against the register
 * rather than asserted — and were the minutes actually filed. A meeting with no minutes is the gap
 * an auditor finds, so the table says so in a column of its own rather than leaving it to be
 * inferred from a missing document.
 *
 * The decisions table carries every action still open across the whole period, because an action
 * recorded in March and forgotten by June is the failure this report exists to prevent.
 */
async function meetingReport(build: Build): Promise<Section[]> {
  const period = { gte: startOfDay(build.params.from), lte: endOfDay(build.params.to) }

  const meetings = await prisma.meeting.findMany({
    where: { cooperativeId: build.cooperativeId, scheduledFor: period },
    orderBy: { scheduledFor: 'asc' },
    take: MAX_TABLE_ROWS,
    select: {
      id: true,
      reference: true,
      title: true,
      type: true,
      status: true,
      scheduledFor: true,
      location: true,
      quorumRequired: true,
      minutesDocumentId: true,
      _count: { select: { decisions: true } },
      // Members only. A quorum is a number of members, so a guest or a member of staff in the
      // room does not count towards it — the same rule the meetings service applies.
      attendees: { where: { status: 'PRESENT', memberId: { not: null } }, select: { id: true } },
    },
  })

  const decisions = await prisma.meetingDecision.findMany({
    where: { meeting: { cooperativeId: build.cooperativeId, scheduledFor: period } },
    orderBy: [{ createdAt: 'asc' }],
    take: MAX_TABLE_ROWS,
    select: {
      title: true,
      decisionType: true,
      status: true,
      votesFor: true,
      votesAgainst: true,
      abstentions: true,
      dueOn: true,
      meeting: { select: { reference: true } },
      responsible: { select: { user: { select: { fullName: true } } } },
    },
  })

  const held = meetings.filter((row) => row.status === 'COMPLETED').length
  const cancelled = meetings.filter((row) => row.status === 'CANCELLED').length
  const openActions = decisions.filter(
    (row) => row.decisionType === 'ACTION' && row.status === 'OPEN',
  ).length

  // Averaged over the meetings that actually happened. Including a cancelled meeting's zero
  // attendance would drag the figure down for a meeting nobody was expected at.
  const attended = meetings.filter((row) => row.status !== 'CANCELLED')
  const averageAttendance =
    attended.length === 0
      ? 0
      : Math.round(
          attended.reduce((running, row) => running + row.attendees.length, 0) / attended.length,
        )

  const quorumLabel = (present: number, required: number | null): string => {
    if (required === null) return t(build, 'report.quorumNone')
    return present >= required ? t(build, 'report.quorumMet') : t(build, 'report.quorumNotMet')
  }

  const votesOf = (row: (typeof decisions)[number]): string | null => {
    if (row.votesFor === null && row.votesAgainst === null && row.abstentions === null) return null
    return `${row.votesFor ?? 0} / ${row.votesAgainst ?? 0} / ${row.abstentions ?? 0}`
  }

  return [
    figures(build, 'meetings', 'meetings', [
      {
        key: 'held',
        label: t(build, 'figure.meetings.held'),
        type: 'number',
        value: count(held),
      },
      {
        key: 'cancelled',
        label: t(build, 'figure.meetings.cancelled'),
        type: 'number',
        value: count(cancelled),
      },
      {
        key: 'attendance',
        label: t(build, 'figure.meetings.attendance'),
        type: 'number',
        value: count(averageAttendance),
      },
      {
        key: 'decisions',
        label: t(build, 'figure.meetings.decisions'),
        type: 'number',
        value: count(decisions.length),
      },
      {
        key: 'actionsOpen',
        label: t(build, 'figure.meetings.actionsOpen'),
        type: 'number',
        value: count(openActions),
      },
    ]),
    table(
      build,
      'meetings',
      'meetings',
      [
        { key: 'date', label: t(build, 'column.date'), type: 'date', weight: 1.6 },
        { key: 'reference', label: t(build, 'column.reference'), type: 'text', weight: 1.8 },
        { key: 'meeting', label: t(build, 'column.meeting'), type: 'text', weight: 3 },
        { key: 'kind', label: t(build, 'column.kind'), type: 'text', weight: 2 },
        { key: 'status', label: t(build, 'column.status'), type: 'text', weight: 1.6 },
        { key: 'present', label: t(build, 'column.attendees'), type: 'number', weight: 1.2 },
        { key: 'quorum', label: t(build, 'column.quorum'), type: 'text', weight: 1.6 },
        { key: 'minutes', label: t(build, 'column.minutes'), type: 'text', weight: 1.6 },
      ],
      meetings.map((row) => ({
        date: row.scheduledFor.toISOString().slice(0, 10),
        reference: row.reference,
        meeting: row.title,
        kind: enumLabel(build.locale, 'meetingType', row.type),
        status: enumLabel(build.locale, 'meetingStatus', row.status),
        present: count(row.attendees.length),
        quorum: quorumLabel(row.attendees.length, row.quorumRequired),
        // Stated rather than left to be inferred from an absent document: a meeting whose minutes
        // were never filed is exactly what an audit looks for.
        minutes: row.minutesDocumentId
          ? t(build, 'report.minutesFiled')
          : t(build, 'report.minutesMissing'),
      })),
    ),
    table(
      build,
      'decisions',
      'decisions',
      [
        { key: 'reference', label: t(build, 'column.reference'), type: 'text', weight: 1.8 },
        { key: 'kind', label: t(build, 'column.kind'), type: 'text', weight: 1.4 },
        { key: 'decision', label: t(build, 'column.decision'), type: 'text', weight: 3.4 },
        { key: 'votes', label: t(build, 'column.votes'), type: 'text', weight: 1.8 },
        { key: 'responsible', label: t(build, 'column.responsible'), type: 'text', weight: 2 },
        { key: 'due', label: t(build, 'column.due'), type: 'date', weight: 1.6 },
        { key: 'status', label: t(build, 'column.status'), type: 'text', weight: 1.4 },
      ],
      decisions.map((row) => ({
        reference: row.meeting.reference,
        kind: enumLabel(build.locale, 'decisionType', row.decisionType),
        decision: row.title,
        votes: votesOf(row),
        responsible: row.responsible?.user.fullName ?? null,
        due: row.dueOn?.toISOString().slice(0, 10) ?? null,
        status: enumLabel(build.locale, 'decisionStatus', row.status),
      })),
    ),
  ]
}

/**
 * Builds a report.
 *
 * The route requires `reports:view`; the report's own data permission is required here, because
 * "may read reports" and "may read the cooperative's money" are two different decisions and the
 * second has to be enforced wherever the money is reached. The server checks this whatever the
 * interface chose to show.
 */
export async function buildReport(
  ctx: RequestContext,
  type: ReportType,
  params: ReportParams,
): Promise<ReportDocument> {
  const cooperative = ctx.cooperative
  if (!cooperative) throw AppError.noCooperativeAccess()

  const definition = REPORTS[type]
  if (!ctx.permissions.has(definition.permission)) {
    throw AppError.forbidden(definition.permission)
  }

  const locale = params.locale ?? ctx.user.locale
  const record = await prisma.cooperative.findUniqueOrThrow({
    where: { id: cooperative.id },
    select: { name: true, code: true, district: true, sector: true, currency: true },
  })

  const build: Build = {
    ctx,
    cooperativeId: cooperative.id,
    locale,
    currency: record.currency,
    params,
    from: startOfDay(params.from),
    to: endOfDay(params.to),
    withheld: [],
  }

  let sections: Section[]
  let subtitle: string | undefined

  switch (type) {
    case 'monthly-cooperative':
      sections = await monthlyCooperative(build)
      break
    case 'financial':
      sections = await financialReport(build)
      break
    case 'member': {
      const built = await memberReport(build)
      sections = built.sections
      subtitle = built.subtitle
      break
    }
    case 'inventory':
      sections = await inventoryReport(build)
      break
    case 'sales':
      sections = await salesReport(build)
      break
    case 'activity':
      sections = await activityReport(build)
      break
    case 'meeting':
      sections = await meetingReport(build)
      break
  }

  const generatedAt = new Date()

  return {
    type,
    title: t(build, `report.${type}`),
    ...(subtitle ? { subtitle } : {}),
    periodLabel: reportPeriodLabel(params.from, params.to, locale),
    from: params.from,
    to: params.to,
    locale,
    currency: record.currency,
    cooperative: {
      name: record.name,
      code: record.code,
      district: record.district,
      sector: record.sector,
    },
    sections,
    generatedAt: generatedAt.toISOString(),
    generatedAtLabel: kigaliDateTime(generatedAt, locale),
    generatedBy: actorLabel(ctx.user),
    withheld: build.withheld,
    rowCount: rowsIn(sections),
  }
}
