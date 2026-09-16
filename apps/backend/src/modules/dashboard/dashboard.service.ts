import type { PermissionKey } from '@coopmanage/shared'
import type { RequestContext } from '../../lib/context.js'
import { AppError } from '../../lib/errors.js'
import { add, fromDatabase, subtract, toWire, ZERO, type Money } from '../../lib/money.js'
import { prisma } from '../../lib/prisma.js'
import { COUNTS_TOWARDS_TOTALS } from '../finance/finance.service.js'

/**
 * The dashboard.
 *
 * **One response, not five.** The phase's exit criterion asks for a single round trip, which is
 * also the only shape that makes sense on the connections this product is used over: five requests
 * on a district office link is five chances to be slow and five spinners resolving at different
 * moments. The planned split into `/dashboard/summary`, `/activity`, `/attention` and `/health` is
 * a recorded deviation in `docs/api.md`.
 *
 * **Every part is gated by the permission covering its own data**, and a part the reader may not
 * see is named in `withheld` rather than dropped. A treasurer's dashboard and a storekeeper's are
 * different dashboards, and neither should wonder whether a missing tile means zero.
 *
 * **Nothing here is stored.** Every figure is computed from the records at read time, so a
 * correction posted this morning shows on the dashboard this morning. A cached headline that
 * disagreed with the ledger would be worse than no headline.
 */

function requireCooperativeId(ctx: RequestContext): string {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw AppError.noCooperativeAccess()
  return cooperativeId
}

function can(ctx: RequestContext, permission: PermissionKey): boolean {
  return ctx.permissions.has(permission)
}

/** The first day of the month `back` months before the one containing `now`. */
function monthStart(now: Date, back = 0): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7)
}

export interface DashboardTile {
  key: string
  /** `money`, `quantity`, `number` — the renderer formats by this, as the reports do. */
  type: 'money' | 'quantity' | 'number'
  value: string
  /** A second figure that gives the first its meaning: "of 412", "31 active". */
  hint?: { key: string; value: string; type: 'money' | 'quantity' | 'number' }
  /** Where the tile leads. A figure a reader cannot act on is half a figure. */
  href?: string
}

export interface ChartPoint {
  /** `2026-09` for a month bucket. The interface writes the month name in the reader's language. */
  bucket: string
  values: Record<string, string>
}

export interface DashboardChart {
  key: string
  series: string[]
  points: ChartPoint[]
}

export interface AttentionItem {
  key: string
  severity: 'WARNING' | 'CRITICAL'
  /** Parameters for the sentence the interface composes. Never a finished sentence. */
  params: Record<string, string | number>
  href?: string
}

export interface ActivityEntry {
  id: string
  action: string
  actor: string
  messageKey: string
  messageParams: Record<string, unknown> | null
  at: string
}

export type HealthRating = 'GOOD' | 'WATCH' | 'ATTENTION'

export interface HealthSignal {
  key: 'money' | 'stock' | 'receivables'
  rating: HealthRating
  /** The figures behind the rating, so the sentence can name them rather than assert. */
  params: Record<string, string | number>
}

export interface Dashboard {
  cooperative: { name: string; code: string }
  /** The month the figures cover, as `2026-09`. */
  month: string
  tiles: DashboardTile[]
  charts: DashboardChart[]
  lowStock: {
    id: string
    name: string
    sku: string
    quantity: string
    minimum: string
    unit: string
  }[]
  attention: AttentionItem[]
  activity: ActivityEntry[]
  health: { rating: HealthRating; signals: HealthSignal[] }
  /** Sections this reader's role does not cover, named rather than silently absent. */
  withheld: string[]
}

export async function getDashboard(ctx: RequestContext): Promise<Dashboard> {
  const cooperativeId = requireCooperativeId(ctx)
  const now = new Date()
  const thisMonth = monthStart(now)
  const nextMonth = monthStart(now, -1)

  const cooperative = await prisma.cooperative.findUniqueOrThrow({
    where: { id: cooperativeId },
    select: { name: true, code: true },
  })

  const withheld: string[] = []
  const tiles: DashboardTile[] = []
  const charts: DashboardChart[] = []
  const attention: AttentionItem[] = []
  const signals: HealthSignal[] = []

  // Each block is independent, so they are gathered in parallel: the criterion is one round trip
  // for the client, not one query for the database.
  const [members, money, stock, sales, activity] = await Promise.all([
    can(ctx, 'members:view') ? memberBlock(cooperativeId, thisMonth, nextMonth) : null,
    can(ctx, 'finance:view') ? moneyBlock(cooperativeId, now) : null,
    can(ctx, 'inventory:view') ? stockBlock(cooperativeId, ctx) : null,
    can(ctx, 'sales:view') ? salesBlock(cooperativeId, now) : null,
    can(ctx, 'audit:view') ? activityBlock(cooperativeId) : null,
  ])

  if (members) {
    tiles.push({
      key: 'members',
      type: 'number',
      value: String(members.active),
      hint: { key: 'members.total', value: String(members.total), type: 'number' },
      href: '/members',
    })
  } else {
    withheld.push('members')
  }

  if (money) {
    tiles.push(
      {
        key: 'balance',
        type: 'money',
        value: toWire(money.balance),
        href: '/finance',
      },
      {
        key: 'income',
        type: 'money',
        value: toWire(money.income),
        hint: { key: 'expenses', value: toWire(money.expenses), type: 'money' },
        href: '/finance/transactions',
      },
    )
    charts.push(money.incomeExpense, money.expensesByCategory)
    signals.push(money.signal)
    attention.push(...money.attention)
  } else {
    withheld.push('finance')
  }

  if (stock) {
    tiles.push({
      key: 'stock',
      type: 'number',
      value: String(stock.products),
      hint: { key: 'lowStock', value: String(stock.low.length), type: 'number' },
      href: '/inventory/stock',
    })
    signals.push(stock.signal)
    attention.push(...stock.attention)
  } else {
    withheld.push('inventory')
  }

  if (sales) {
    tiles.push({
      key: 'sales',
      type: 'money',
      value: toWire(sales.sold),
      hint: { key: 'outstanding', value: toWire(sales.outstanding), type: 'money' },
      href: '/sales',
    })
    charts.push(sales.chart)
    signals.push(sales.signal)
    attention.push(...sales.attention)
  } else {
    withheld.push('sales')
  }

  if (!activity) withheld.push('activity')

  // Open actions from a meeting are everybody's business, not only the secretary's: the point of
  // recording one is that the next meeting can ask about it.
  if (can(ctx, 'meetings:view')) {
    attention.push(...(await overdueActions(cooperativeId, now)))
  }

  return {
    cooperative,
    month: monthKey(thisMonth),
    tiles,
    charts,
    lowStock: stock?.low ?? [],
    // Worst first, so the thing that needs doing today is at the top of the list.
    attention: attention.sort((a, b) =>
      a.severity === b.severity ? 0 : a.severity === 'CRITICAL' ? -1 : 1,
    ),
    activity: activity ?? [],
    health: { rating: worst(signals), signals },
    withheld,
  }
}

/** The worst of the signals. A cooperative is as healthy as its least healthy part. */
function worst(signals: HealthSignal[]): HealthRating {
  if (signals.some((signal) => signal.rating === 'ATTENTION')) return 'ATTENTION'
  if (signals.some((signal) => signal.rating === 'WATCH')) return 'WATCH'
  return 'GOOD'
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

async function memberBlock(cooperativeId: string, from: Date, to: Date) {
  const [total, active, joined] = await Promise.all([
    prisma.member.count({ where: { cooperativeId } }),
    prisma.member.count({ where: { cooperativeId, status: 'ACTIVE' } }),
    prisma.member.count({ where: { cooperativeId, joinedOn: { gte: from, lt: to } } }),
  ])
  return { total, active, joined }
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * The money block: the balance, this month's flows, twelve months of both, and where it went.
 *
 * Every figure uses `COUNTS_TOWARDS_TOTALS`, imported from the finance service rather than
 * restated, so a voided entry and its reversal are excluded as a pair here exactly as they are in
 * the ledger. A dashboard that disagreed with the ledger it summarises would be worse than none.
 */
async function moneyBlock(cooperativeId: string, now: Date) {
  const twelveMonthsAgo = monthStart(now, 11)
  const thisMonth = monthStart(now)
  const nextMonth = monthStart(now, -1)

  const [flows, monthly, byCategory] = await Promise.all([
    prisma.financeTransaction.groupBy({
      by: ['kind'],
      where: { cooperativeId, ...COUNTS_TOWARDS_TOTALS },
      _sum: { amount: true },
    }),
    prisma.$queryRaw<{ bucket: Date; kind: string; total: unknown }[]>`
      SELECT date_trunc('month', occurred_at) AS bucket, kind, sum(amount) AS total
        FROM finance_transactions
       WHERE cooperative_id = ${cooperativeId}::uuid
         AND status = 'POSTED'
         AND reversal_of_id IS NULL
         AND occurred_at >= ${twelveMonthsAgo}
       GROUP BY 1, 2
       ORDER BY 1
    `,
    prisma.$queryRaw<{ name: string; name_rw: string | null; total: unknown }[]>`
      SELECT c.name, c.name_rw, sum(t.amount) AS total
        FROM finance_transactions t
        JOIN finance_categories c ON c.id = t.category_id
       WHERE t.cooperative_id = ${cooperativeId}::uuid
         AND t.status = 'POSTED'
         AND t.reversal_of_id IS NULL
         AND t.kind = 'EXPENSE'
         AND t.occurred_at >= ${thisMonth}
         AND t.occurred_at < ${nextMonth}
       GROUP BY c.name, c.name_rw
       ORDER BY sum(t.amount) DESC
    `,
  ])

  const allIncome = fromDatabase(flows.find((row) => row.kind === 'INCOME')?._sum.amount)
  const allExpenses = fromDatabase(flows.find((row) => row.kind === 'EXPENSE')?._sum.amount)
  const balance = subtract(allIncome, allExpenses)

  // Twelve buckets, including the empty ones: a chart that skipped a quiet month would draw a line
  // between two points that are not adjacent.
  const buckets = new Map<string, { income: Money; expenses: Money }>()
  for (let back = 11; back >= 0; back -= 1) {
    buckets.set(monthKey(monthStart(now, back)), { income: ZERO, expenses: ZERO })
  }
  for (const row of monthly) {
    const key = monthKey(row.bucket)
    const current = buckets.get(key)
    if (!current) continue
    const amount = fromDatabase(row.total)
    buckets.set(
      key,
      row.kind === 'INCOME'
        ? { ...current, income: add(current.income, amount) }
        : { ...current, expenses: add(current.expenses, amount) },
    )
  }

  const thisKey = monthKey(thisMonth)
  const thisMonthFlows = buckets.get(thisKey) ?? { income: ZERO, expenses: ZERO }

  /**
   * Expenses by category: the six largest, then everything else as one.
   *
   * Six and an "Other" is the most a horizontal bar chart says clearly; beyond that the reader is
   * reading a table with decoration. The remainder is kept rather than dropped, so the bars still
   * add up to what the month cost.
   */
  const top = byCategory.slice(0, 6)
  const rest = byCategory.slice(6)
  const otherTotal = rest.reduce<Money>(
    (running, row) => add(running, fromDatabase(row.total)),
    ZERO,
  )

  const categoryPoints: ChartPoint[] = top.map((row) => ({
    bucket: row.name,
    values: { amount: toWire(fromDatabase(row.total)), nameRw: row.name_rw ?? '' },
  }))
  if (rest.length > 0) {
    categoryPoints.push({
      bucket: 'other',
      values: { amount: toWire(otherTotal), nameRw: '' },
    })
  }

  const signal = moneySignal(balance, thisMonthFlows.income, thisMonthFlows.expenses)

  const attention: AttentionItem[] = []
  if (balance.isNegative()) {
    attention.push({
      key: 'negativeBalance',
      severity: 'CRITICAL',
      params: { balance: toWire(balance) },
      href: '/finance',
    })
  }

  return {
    balance,
    income: thisMonthFlows.income,
    expenses: thisMonthFlows.expenses,
    signal,
    attention,
    incomeExpense: {
      key: 'incomeExpense',
      series: ['income', 'expenses'],
      points: [...buckets.entries()].map(([bucket, value]) => ({
        bucket,
        values: { income: toWire(value.income), expenses: toWire(value.expenses) },
      })),
    } satisfies DashboardChart,
    expensesByCategory: {
      key: 'expensesByCategory',
      series: ['amount'],
      points: categoryPoints,
    } satisfies DashboardChart,
  }
}

/**
 * How the money is doing, and why.
 *
 * A negative balance is the one unambiguous emergency: the cooperative owes more than it holds.
 * Spending more than came in during a single month is worth watching and is not by itself a
 * problem — a cooperative buying fertiliser before planting does exactly that — so it is a WATCH
 * with the two figures named, never an alarm.
 */
function moneySignal(balance: Money, income: Money, expenses: Money): HealthSignal {
  const params = {
    balance: toWire(balance),
    income: toWire(income),
    expenses: toWire(expenses),
  }
  if (balance.isNegative()) return { key: 'money', rating: 'ATTENTION', params }
  if (expenses.greaterThan(income)) return { key: 'money', rating: 'WATCH', params }
  return { key: 'money', rating: 'GOOD', params }
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

async function stockBlock(cooperativeId: string, ctx: RequestContext) {
  const rows = await prisma.$queryRaw<
    {
      id: string
      name: string
      name_rw: string | null
      sku: string
      symbol: string
      held: unknown
      minimum: unknown
    }[]
  >`
    SELECT p.id, p.name, p.name_rw, p.sku, u.symbol,
           sum(l.quantity) AS held, p.min_stock_level AS minimum
      FROM products p
      JOIN stock_levels l ON l.product_id = p.id
      JOIN units_of_measure u ON u.id = p.unit_id
     WHERE p.cooperative_id = ${cooperativeId}::uuid
       AND p.is_active
       AND p.track_inventory
       AND p.min_stock_level IS NOT NULL
     GROUP BY p.id, p.name, p.name_rw, p.sku, u.symbol, p.min_stock_level
    HAVING sum(l.quantity) <= p.min_stock_level
     ORDER BY sum(l.quantity) / NULLIF(p.min_stock_level, 0) ASC
     LIMIT 8
  `

  const products = await prisma.product.count({
    where: { cooperativeId, isActive: true, trackInventory: true },
  })

  const low = rows.map((row) => ({
    id: row.id,
    // The cooperative's own name for the product where it gave one in Kinyarwanda; the interface
    // picks, because it knows the reader's language.
    name: ctx.user.locale === 'RW' && row.name_rw ? row.name_rw : row.name,
    sku: row.sku,
    quantity: toWire(fromDatabase(row.held), 3),
    minimum: toWire(fromDatabase(row.minimum), 3),
    unit: row.symbol,
  }))

  // A product at zero is not the same as a product running low: one stops the cooperative selling.
  const empty = low.filter((row) => fromDatabase(row.quantity).isZero())

  const attention: AttentionItem[] = []
  if (empty.length > 0) {
    attention.push({
      key: 'outOfStock',
      severity: 'CRITICAL',
      params: { count: empty.length, product: empty[0]?.name ?? '' },
      href: '/inventory/stock',
    })
  } else if (low.length > 0) {
    attention.push({
      key: 'lowStock',
      severity: 'WARNING',
      params: { count: low.length, product: low[0]?.name ?? '' },
      href: '/inventory/stock',
    })
  }

  const rating: HealthRating = empty.length > 0 ? 'ATTENTION' : low.length > 0 ? 'WATCH' : 'GOOD'
  const signal: HealthSignal = {
    key: 'stock',
    rating,
    /**
     * `count` is the number this particular sentence is about, and it changes with the rating:
     * what is out of stock when something is, otherwise what is running low, otherwise how many
     * products there are at all.
     *
     * It is here because the sentence has to be grammatical. Three independent figures cannot all
     * govern a verb, and "1 products are out of stock" is not a sentence the product should put in
     * front of a manager. The interface passes this to the translator as the plural selector, and
     * each rating's sentence is written to agree with its own number and to name the other two as
     * bare figures.
     */
    params: {
      low: low.length,
      empty: empty.length,
      products,
      count: rating === 'ATTENTION' ? empty.length : rating === 'WATCH' ? low.length : products,
    },
  }

  return { products, low, attention, signal }
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

/**
 * Six months of sales, with the six before them for comparison.
 *
 * The comparison is the point: "we sold four million francs" means nothing on its own, and
 * "four million against three and a half last half-year" is a sentence a manager can act on.
 */
async function salesBlock(cooperativeId: string, now: Date) {
  // Twelve months are read and the last six are shown: the six before them are the comparison the
  // chart ghosts behind the line, so both halves come out of one query.
  const twelveMonthsAgo = monthStart(now, 11)
  const thisMonth = monthStart(now)
  const nextMonth = monthStart(now, -1)

  const [monthly, thisMonthTotals, owing] = await Promise.all([
    prisma.$queryRaw<{ bucket: Date; total: unknown }[]>`
      SELECT date_trunc('month', sale_date) AS bucket, sum(total) AS total
        FROM sales
       WHERE cooperative_id = ${cooperativeId}::uuid
         AND status = 'CONFIRMED'
         AND sale_date >= ${twelveMonthsAgo}
       GROUP BY 1
       ORDER BY 1
    `,
    prisma.sale.aggregate({
      where: {
        cooperativeId,
        status: 'CONFIRMED',
        saleDate: { gte: thisMonth, lt: nextMonth },
      },
      _sum: { total: true, amountPaid: true },
    }),
    // What is still owed across every confirmed sale, and how old the oldest of it is. A
    // cancelled sale owes nothing: its stock went back and its payments were reversed.
    prisma.$queryRaw<{ outstanding: unknown; oldest: Date | null; count: bigint }[]>`
      SELECT sum(total - amount_paid) AS outstanding,
             min(sale_date) AS oldest,
             count(*) AS count
        FROM sales
       WHERE cooperative_id = ${cooperativeId}::uuid
         AND status = 'CONFIRMED'
         AND total > amount_paid
    `,
  ])

  const buckets = new Map<string, Money>()
  for (let back = 11; back >= 0; back -= 1) buckets.set(monthKey(monthStart(now, back)), ZERO)
  for (const row of monthly) {
    const key = monthKey(row.bucket)
    if (buckets.has(key)) buckets.set(key, fromDatabase(row.total))
  }

  const keys = [...buckets.keys()]
  const recent = keys.slice(6)
  const previous = keys.slice(0, 6)

  /**
   * The previous half-year is ghosted behind the recent one, month for month: the point six months
   * ago sits under the point today, so the reader compares like with like rather than reading two
   * lines that happen to share an axis.
   */
  const points: ChartPoint[] = recent.map((bucket, index) => ({
    bucket,
    values: {
      sold: toWire(buckets.get(bucket) ?? ZERO),
      previous: toWire(buckets.get(previous[index] ?? '') ?? ZERO),
    },
  }))

  const sold = fromDatabase(thisMonthTotals._sum.total)
  const paid = fromDatabase(thisMonthTotals._sum.amountPaid)
  const outstanding = fromDatabase(owing[0]?.outstanding)
  const oldest = owing[0]?.oldest ?? null
  const owingCount = Number(owing[0]?.count ?? 0)

  const daysOwed = oldest ? Math.floor((now.getTime() - oldest.getTime()) / 86_400_000) : 0

  const attention: AttentionItem[] = []
  if (owingCount > 0 && daysOwed >= 60) {
    attention.push({
      key: 'oldDebt',
      severity: 'CRITICAL',
      params: { days: daysOwed, amount: toWire(outstanding), count: owingCount },
      href: '/sales',
    })
  } else if (owingCount > 0) {
    attention.push({
      key: 'outstanding',
      severity: 'WARNING',
      params: { amount: toWire(outstanding), count: owingCount },
      href: '/sales',
    })
  }

  const signal: HealthSignal = {
    key: 'receivables',
    // Sixty days is the line: a buyer who has not paid in two months is a buyer the committee
    // should be discussing, whatever the amount.
    rating: daysOwed >= 60 ? 'ATTENTION' : owingCount > 0 ? 'WATCH' : 'GOOD',
    params: { outstanding: toWire(outstanding), count: owingCount, days: daysOwed },
  }

  return {
    sold,
    paid,
    outstanding,
    attention,
    signal,
    chart: { key: 'sales', series: ['sold', 'previous'], points } satisfies DashboardChart,
  }
}

// ---------------------------------------------------------------------------
// Meetings, activity
// ---------------------------------------------------------------------------

/** Actions a meeting agreed to and nobody has closed, past the date they were due. */
async function overdueActions(cooperativeId: string, now: Date): Promise<AttentionItem[]> {
  const overdue = await prisma.meetingDecision.count({
    where: {
      meeting: { cooperativeId },
      decisionType: 'ACTION',
      status: 'OPEN',
      dueOn: { lt: new Date(now.toISOString().slice(0, 10)) },
    },
  })
  if (overdue === 0) return []
  return [
    {
      key: 'overdueActions',
      severity: 'WARNING',
      params: { count: overdue },
      href: '/meetings',
    },
  ]
}

/**
 * The last few things anybody did.
 *
 * Read from the audit log, so it needs `audit:view` and not merely `dashboard:view`: the trail
 * names who did what, and a cooperative's staff list is not something every role should be able to
 * watch. A reader without it gets the rest of the dashboard and `activity` in `withheld`.
 */
async function activityBlock(cooperativeId: string): Promise<ActivityEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: { cooperativeId },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: {
      id: true,
      action: true,
      actorLabel: true,
      messageKey: true,
      messageParams: true,
      createdAt: true,
    },
  })

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actor: row.actorLabel,
    messageKey: row.messageKey,
    messageParams: (row.messageParams as Record<string, unknown> | null) ?? null,
    at: row.createdAt.toISOString(),
  }))
}
