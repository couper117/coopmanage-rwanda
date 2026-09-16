import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import type { PermissionKey } from '@coopmanage/shared'
import type { RequestContext } from '../../lib/context.js'
import { add, fromDatabase, subtract, toWire, ZERO, type Money } from '../../lib/money.js'
import { prisma } from '../../lib/prisma.js'
import { COUNTS_TOWARDS_TOTALS } from '../finance/finance.service.js'

/**
 * Everything the assistant can find out, and nothing else.
 *
 * This catalogue is the phase's guarantee, not a convenience. The exit criterion — an adversarial
 * prompt cannot make the assistant produce a number absent from the database, or reach another
 * cooperative's data — is met by three properties of this file, none of which depends on a prompt
 * instruction or on a model behaving well.
 *
 * **Every figure comes from a query here.** A tool returns figures; the answer is assembled from
 * them by `assistant.service.ts`. Nothing anywhere in this module turns a model's prose into a
 * number a cooperative might act on, because no model writes any part of an answer's numbers.
 *
 * **Every query is scoped by `ctx`.** The cooperative comes from the resolved tenant, exactly as
 * in every other module, so there is no argument a caller could pass — or a model could invent —
 * that reaches another cooperative. The tools take periods and names, never a cooperative id.
 *
 * **Every tool declares its permission**, and the catalogue is filtered per request before a
 * question is even looked at. A storekeeper's assistant cannot answer a question about money,
 * because the tool that knows about money is not in the set it was given.
 *
 * All of them read. There is no write tool and there is no place to add one: a tool returns
 * figures, and the service only ever reads what it returns.
 */

export interface ToolFigure {
  /** Translation key, rendered by the interface. Never a sentence composed here. */
  labelKey: string
  /** Decimal string for money, a plain integer for a count, a date for a date. */
  value: string
  type: 'money' | 'number' | 'quantity' | 'text' | 'date'
}

export interface ToolAnswer {
  /**
   * The sentence, as a key and its values.
   *
   * The interface renders it in the reader's language. An answer written as prose here would be an
   * answer in one language, which for this product is no answer at all — and an answer written by
   * a model would be a number nobody could trace.
   */
  answerKey: string
  answerParams: Record<string, string | number>
  /** What the reader is shown beside the sentence, so they can check it. */
  figures: ToolFigure[]
  /** The screen that shows the same thing in full. */
  href: string | null
  /** The rows the answer was built from, stored so any figure can be traced to its query. */
  snapshot: unknown
}

/** A period, defaulting to this month, which is what almost every question means. */
const periodArgs = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .strict()

const nameArgs = z.object({ name: z.string().trim().min(2).max(80) }).strict()

const noArgs = z.object({}).strict()

interface ToolDefinition<TArgs> {
  key: string
  /** Held by the caller, or the tool is not in their catalogue at all. */
  permission: PermissionKey
  /** What the tool answers, in one line, for the planner and for the help text. */
  summaryKey: string
  args: z.ZodType<TArgs>
  run: (ctx: RequestContext, args: TArgs) => Promise<ToolAnswer>
}

/**
 * A tool as the catalogue holds it: its argument type erased, and its schema applied on the way in.
 *
 * The erasure is what lets one list hold tools with different arguments. Parsing inside `run` is
 * the more important half: a tool cannot be called with arguments that were not validated against
 * its own schema, whatever the planner proposed. The planner is the only thing that chooses
 * arguments, and it is the thing least worth trusting.
 */
export interface AssistantTool {
  key: string
  permission: PermissionKey
  summaryKey: string
  args: z.ZodType
  run: (ctx: RequestContext, raw: unknown) => Promise<ToolAnswer>
}

function defineTool<TArgs>(tool: ToolDefinition<TArgs>): AssistantTool {
  return {
    key: tool.key,
    permission: tool.permission,
    summaryKey: tool.summaryKey,
    args: tool.args,
    run: (ctx, raw) => tool.run(ctx, tool.args.parse(raw)),
  }
}

function requireCooperativeId(ctx: RequestContext): string {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw new Error('the assistant ran a tool with no cooperative resolved')
  return cooperativeId
}

/** This month, unless the question named a period. */
function resolvePeriod(args: { from?: string; to?: string }): {
  from: Date
  to: Date
  label: string
} {
  const now = new Date()
  const from = args.from
    ? new Date(`${args.from}T00:00:00.000Z`)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const to = args.to
    ? new Date(`${args.to}T23:59:59.999Z`)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999))
  return { from, to, label: `${from.toISOString().slice(0, 10)}..${to.toISOString().slice(0, 10)}` }
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

const countMembers = defineTool({
  key: 'countMembers',
  permission: 'members:view',
  summaryKey: 'tools.countMembers',
  args: noArgs,
  async run(ctx) {
    const cooperativeId = requireCooperativeId(ctx)
    const [total, active, inactive] = await Promise.all([
      prisma.member.count({ where: { cooperativeId } }),
      prisma.member.count({ where: { cooperativeId, status: 'ACTIVE' } }),
      prisma.member.count({ where: { cooperativeId, status: { not: 'ACTIVE' } } }),
    ])

    return {
      answerKey: 'answer.countMembers',
      answerParams: { total, active },
      figures: [
        { labelKey: 'figure.members.total', value: String(total), type: 'number' },
        { labelKey: 'figure.members.active', value: String(active), type: 'number' },
        { labelKey: 'figure.members.inactive', value: String(inactive), type: 'number' },
      ],
      href: '/members',
      snapshot: { total, active, inactive },
    }
  },
})

const membersWithoutPhone = defineTool({
  key: 'membersWithoutPhone',
  permission: 'members:view',
  summaryKey: 'tools.membersWithoutPhone',
  args: noArgs,
  async run(ctx) {
    const cooperativeId = requireCooperativeId(ctx)
    const [withoutPhone, active] = await Promise.all([
      prisma.member.count({ where: { cooperativeId, status: 'ACTIVE', phone: null } }),
      prisma.member.count({ where: { cooperativeId, status: 'ACTIVE' } }),
    ])

    return {
      answerKey: 'answer.membersWithoutPhone',
      answerParams: { count: withoutPhone, active },
      figures: [
        { labelKey: 'figure.members.withoutPhone', value: String(withoutPhone), type: 'number' },
        { labelKey: 'figure.members.active', value: String(active), type: 'number' },
      ],
      // Not a defect to be fixed: a phone number is never required of a member. The figure tells
      // the committee how many an SMS cannot reach, which is what decides whether a meeting is
      // called by telephone or by word of mouth.
      href: '/members?hasPhone=no',
      snapshot: { withoutPhone, active },
    }
  },
})

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

function financeWhere(
  cooperativeId: string,
  extra: Prisma.FinanceTransactionWhereInput = {},
): Prisma.FinanceTransactionWhereInput {
  // The same rule the ledger and the reports use, imported rather than restated: a voided entry
  // and its reversal are excluded as a pair.
  return { cooperativeId, ...COUNTS_TOWARDS_TOTALS, ...extra }
}

const financeBalance = defineTool({
  key: 'financeBalance',
  permission: 'finance:view',
  summaryKey: 'tools.financeBalance',
  args: noArgs,
  async run(ctx) {
    const cooperativeId = requireCooperativeId(ctx)
    const grouped = await prisma.financeTransaction.groupBy({
      by: ['kind'],
      where: financeWhere(cooperativeId),
      _sum: { amount: true },
    })

    const income = fromDatabase(grouped.find((row) => row.kind === 'INCOME')?._sum.amount)
    const expenses = fromDatabase(grouped.find((row) => row.kind === 'EXPENSE')?._sum.amount)
    const balance = subtract(income, expenses)

    return {
      answerKey: 'answer.financeBalance',
      answerParams: { balance: toWire(balance) },
      figures: [
        { labelKey: 'figure.finance.balance', value: toWire(balance), type: 'money' },
        { labelKey: 'figure.finance.incomeAllTime', value: toWire(income), type: 'money' },
        { labelKey: 'figure.finance.expensesAllTime', value: toWire(expenses), type: 'money' },
      ],
      href: '/finance',
      snapshot: { income: toWire(income), expenses: toWire(expenses), balance: toWire(balance) },
    }
  },
})

const financeFlows = defineTool({
  key: 'financeFlows',
  permission: 'finance:view',
  summaryKey: 'tools.financeFlows',
  args: periodArgs,
  async run(ctx, args) {
    const cooperativeId = requireCooperativeId(ctx)
    const period = resolvePeriod(args)

    const grouped = await prisma.financeTransaction.groupBy({
      by: ['kind'],
      where: financeWhere(cooperativeId, { occurredAt: { gte: period.from, lte: period.to } }),
      _sum: { amount: true },
      _count: { _all: true },
    })

    const income = fromDatabase(grouped.find((row) => row.kind === 'INCOME')?._sum.amount)
    const expenses = fromDatabase(grouped.find((row) => row.kind === 'EXPENSE')?._sum.amount)
    const entries = grouped.reduce((running, row) => running + row._count._all, 0)

    return {
      answerKey: 'answer.financeFlows',
      answerParams: {
        income: toWire(income),
        expenses: toWire(expenses),
        from: period.from.toISOString().slice(0, 10),
        to: period.to.toISOString().slice(0, 10),
      },
      figures: [
        { labelKey: 'figure.finance.income', value: toWire(income), type: 'money' },
        { labelKey: 'figure.finance.expenses', value: toWire(expenses), type: 'money' },
        {
          labelKey: 'figure.finance.net',
          value: toWire(subtract(income, expenses)),
          type: 'money',
        },
        { labelKey: 'figure.finance.entries', value: String(entries), type: 'number' },
      ],
      href: '/finance/transactions',
      snapshot: {
        period: period.label,
        income: toWire(income),
        expenses: toWire(expenses),
        entries,
      },
    }
  },
})

const topExpenseCategories = defineTool({
  key: 'topExpenseCategories',
  permission: 'finance:view',
  summaryKey: 'tools.topExpenseCategories',
  args: periodArgs,
  async run(ctx, args) {
    const cooperativeId = requireCooperativeId(ctx)
    const period = resolvePeriod(args)

    const grouped = await prisma.financeTransaction.groupBy({
      by: ['categoryId'],
      where: financeWhere(cooperativeId, {
        kind: 'EXPENSE',
        occurredAt: { gte: period.from, lte: period.to },
      }),
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 5,
    })

    const categories = await prisma.financeCategory.findMany({
      where: { id: { in: grouped.map((row) => row.categoryId) } },
      select: { id: true, name: true, nameRw: true },
    })
    const named = new Map(categories.map((row) => [row.id, row]))

    const rows = grouped.map((row) => {
      const category = named.get(row.categoryId)
      const amount = fromDatabase(row._sum.amount)
      return {
        name: category?.name ?? '',
        nameRw: category?.nameRw ?? null,
        amount: toWire(amount),
      }
    })

    const largest = rows[0]

    const dates = {
      from: period.from.toISOString().slice(0, 10),
      to: period.to.toISOString().slice(0, 10),
    }

    const answerParams: ToolAnswer['answerParams'] = largest
      ? {
          ...dates,
          // The cooperative's own name for the category. The interface picks the language, because
          // it knows the reader's; the tool sends both.
          category: largest.name,
          categoryRw: largest.nameRw ?? largest.name,
          amount: largest.amount,
        }
      : dates

    return {
      answerKey: largest ? 'answer.topExpenseCategories' : 'answer.topExpenseCategories.none',
      answerParams,
      figures: rows.map((row) => ({
        labelKey: `literal:${row.name}`,
        value: row.amount,
        type: 'money' as const,
      })),
      href: '/reports',
      snapshot: { period: period.label, rows },
    }
  },
})

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

const lowStockProducts = defineTool({
  key: 'lowStockProducts',
  permission: 'inventory:view',
  summaryKey: 'tools.lowStockProducts',
  args: noArgs,
  async run(ctx) {
    const cooperativeId = requireCooperativeId(ctx)
    const rows = await prisma.$queryRaw<
      { name: string; name_rw: string | null; symbol: string; held: unknown; minimum: unknown }[]
    >`
      SELECT p.name, p.name_rw, u.symbol,
             sum(l.quantity) AS held, p.min_stock_level AS minimum
        FROM products p
        JOIN stock_levels l ON l.product_id = p.id
        JOIN units_of_measure u ON u.id = p.unit_id
       WHERE p.cooperative_id = ${cooperativeId}::uuid
         AND p.is_active = true
         AND p.track_inventory = true
         AND p.min_stock_level IS NOT NULL
       GROUP BY p.id, p.name, p.name_rw, u.symbol, p.min_stock_level
      HAVING sum(l.quantity) <= p.min_stock_level
       ORDER BY sum(l.quantity) ASC
       LIMIT 10
    `

    const products = rows.map((row) => ({
      name: row.name,
      nameRw: row.name_rw,
      held: toWire(fromDatabase(row.held), 3),
      minimum: toWire(fromDatabase(row.minimum), 3),
      unit: row.symbol,
    }))
    const first = products[0]
    const answerParams: ToolAnswer['answerParams'] = first
      ? { count: products.length, product: first.name, productRw: first.nameRw ?? first.name }
      : {}

    return {
      answerKey: first ? 'answer.lowStockProducts' : 'answer.lowStockProducts.none',
      answerParams,
      figures: products.map((row) => ({
        labelKey: `literal:${row.name}`,
        value: `${row.held} ${row.unit}`,
        type: 'text' as const,
      })),
      href: '/inventory/stock',
      snapshot: { products },
    }
  },
})

const stockOnHand = defineTool({
  key: 'stockOnHand',
  permission: 'inventory:view',
  summaryKey: 'tools.stockOnHand',
  args: nameArgs,
  async run(ctx, args) {
    const cooperativeId = requireCooperativeId(ctx)
    const product = await prisma.product.findFirst({
      where: {
        cooperativeId,
        isActive: true,
        OR: [
          { name: { contains: args.name, mode: 'insensitive' } },
          { nameRw: { contains: args.name, mode: 'insensitive' } },
          { sku: { contains: args.name, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, nameRw: true, unit: { select: { symbol: true } } },
    })

    if (!product) {
      const missing: ToolAnswer = {
        answerKey: 'answer.stockOnHand.noSuchProduct',
        answerParams: { name: args.name },
        figures: [],
        href: '/inventory/products',
        snapshot: { searched: args.name, found: false },
      }
      return missing
    }

    const levels = await prisma.stockLevel.groupBy({
      by: ['productId'],
      where: { cooperativeId, productId: product.id },
      _sum: { quantity: true },
    })
    const held = fromDatabase(levels[0]?._sum.quantity)

    return {
      answerKey: 'answer.stockOnHand',
      answerParams: {
        product: product.name,
        productRw: product.nameRw ?? product.name,
        quantity: toWire(held, 3),
        unit: product.unit.symbol,
      },
      figures: [
        {
          labelKey: 'figure.stock.onHand',
          value: `${toWire(held, 3)} ${product.unit.symbol}`,
          type: 'text',
        },
      ],
      href: '/inventory/stock',
      snapshot: { product: product.name, held: toWire(held, 3), unit: product.unit.symbol },
    }
  },
})

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

const salesTotal = defineTool({
  key: 'salesTotal',
  permission: 'sales:view',
  summaryKey: 'tools.salesTotal',
  args: periodArgs,
  async run(ctx, args) {
    const cooperativeId = requireCooperativeId(ctx)
    const period = resolvePeriod(args)

    const totals = await prisma.sale.aggregate({
      where: {
        cooperativeId,
        status: 'CONFIRMED',
        saleDate: { gte: period.from, lte: period.to },
      },
      _sum: { total: true, amountPaid: true },
      _count: { _all: true },
    })

    const sold = fromDatabase(totals._sum.total)
    const paid = fromDatabase(totals._sum.amountPaid)

    return {
      answerKey: 'answer.salesTotal',
      answerParams: {
        sold: toWire(sold),
        count: totals._count._all,
        from: period.from.toISOString().slice(0, 10),
        to: period.to.toISOString().slice(0, 10),
      },
      figures: [
        { labelKey: 'figure.sales.sold', value: toWire(sold), type: 'money' },
        { labelKey: 'figure.sales.paid', value: toWire(paid), type: 'money' },
        {
          labelKey: 'figure.sales.outstanding',
          value: toWire(subtract(sold, paid)),
          type: 'money',
        },
        { labelKey: 'figure.sales.count', value: String(totals._count._all), type: 'number' },
      ],
      href: '/sales',
      snapshot: { period: period.label, sold: toWire(sold), paid: toWire(paid) },
    }
  },
})

const outstandingFromBuyers = defineTool({
  key: 'outstandingFromBuyers',
  permission: 'sales:view',
  summaryKey: 'tools.outstandingFromBuyers',
  args: noArgs,
  async run(ctx) {
    const cooperativeId = requireCooperativeId(ctx)
    const rows = await prisma.sale.findMany({
      where: { cooperativeId, status: 'CONFIRMED', paymentStatus: { not: 'PAID' } },
      orderBy: { saleDate: 'asc' },
      take: 10,
      select: {
        reference: true,
        saleDate: true,
        total: true,
        amountPaid: true,
        buyer: { select: { name: true } },
      },
    })

    let outstanding: Money = ZERO
    const owing = rows.map((row) => {
      const left = subtract(fromDatabase(row.total), fromDatabase(row.amountPaid))
      outstanding = add(outstanding, left)
      return {
        reference: row.reference,
        buyer: row.buyer.name,
        since: row.saleDate.toISOString().slice(0, 10),
        outstanding: toWire(left),
      }
    })
    const oldest = owing[0]
    const answerParams: ToolAnswer['answerParams'] = oldest
      ? {
          amount: toWire(outstanding),
          count: owing.length,
          buyer: oldest.buyer,
          since: oldest.since,
        }
      : {}

    return {
      answerKey: oldest ? 'answer.outstandingFromBuyers' : 'answer.outstandingFromBuyers.none',
      answerParams,
      figures: owing.map((row) => ({
        labelKey: `literal:${row.buyer} · ${row.reference}`,
        value: row.outstanding,
        type: 'money' as const,
      })),
      href: '/sales',
      snapshot: { outstanding: toWire(outstanding), owing },
    }
  },
})

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

const openDecisions = defineTool({
  key: 'openDecisions',
  permission: 'meetings:view',
  summaryKey: 'tools.openDecisions',
  args: noArgs,
  async run(ctx) {
    const cooperativeId = requireCooperativeId(ctx)
    const rows = await prisma.meetingDecision.findMany({
      where: { meeting: { cooperativeId }, decisionType: 'ACTION', status: 'OPEN' },
      orderBy: [{ dueOn: 'asc' }],
      take: 10,
      select: {
        title: true,
        dueOn: true,
        responsible: { select: { user: { select: { fullName: true } } } },
      },
    })

    const today = new Date().toISOString().slice(0, 10)
    const actions = rows.map((row) => ({
      title: row.title,
      dueOn: row.dueOn?.toISOString().slice(0, 10) ?? null,
      responsible: row.responsible?.user.fullName ?? null,
      overdue: row.dueOn !== null && row.dueOn.toISOString().slice(0, 10) < today,
    }))
    const overdue = actions.filter((row) => row.overdue).length
    const answerParams: ToolAnswer['answerParams'] =
      actions.length > 0 ? { count: actions.length, overdue } : {}

    return {
      answerKey: actions.length > 0 ? 'answer.openDecisions' : 'answer.openDecisions.none',
      answerParams,
      figures: actions.map((row) => ({
        labelKey: `literal:${row.title}`,
        value: row.dueOn ?? '',
        type: 'date' as const,
      })),
      href: '/meetings',
      snapshot: { actions },
    }
  },
})

const nextMeeting = defineTool({
  key: 'nextMeeting',
  permission: 'meetings:view',
  summaryKey: 'tools.nextMeeting',
  args: noArgs,
  async run(ctx) {
    const cooperativeId = requireCooperativeId(ctx)
    const meeting = await prisma.meeting.findFirst({
      where: { cooperativeId, status: 'SCHEDULED', scheduledFor: { gte: new Date() } },
      orderBy: { scheduledFor: 'asc' },
      select: { id: true, reference: true, title: true, scheduledFor: true, location: true },
    })

    if (!meeting) {
      const none: ToolAnswer = {
        answerKey: 'answer.nextMeeting.none',
        answerParams: {},
        figures: [],
        href: '/meetings',
        snapshot: { found: false },
      }
      return none
    }

    return {
      answerKey: 'answer.nextMeeting',
      answerParams: {
        title: meeting.title,
        date: meeting.scheduledFor.toISOString(),
        place: meeting.location ?? '',
      },
      figures: [
        { labelKey: 'figure.meeting.title', value: meeting.title, type: 'text' },
        {
          labelKey: 'figure.meeting.when',
          value: meeting.scheduledFor.toISOString().slice(0, 10),
          type: 'date',
        },
      ],
      href: `/meetings/${meeting.id}`,
      snapshot: { reference: meeting.reference, scheduledFor: meeting.scheduledFor.toISOString() },
    }
  },
})

const contributionsTotal = defineTool({
  key: 'contributionsTotal',
  permission: 'contributions:view',
  summaryKey: 'tools.contributionsTotal',
  args: periodArgs,
  async run(ctx, args) {
    const cooperativeId = requireCooperativeId(ctx)
    const period = resolvePeriod(args)

    const totals = await prisma.contribution.aggregate({
      // A contribution is dated by the day it was paid, which is not always the day it was typed.
      where: { cooperativeId, status: 'POSTED', paidOn: { gte: period.from, lte: period.to } },
      _sum: { amount: true },
      _count: true,
    })
    const total = fromDatabase(totals._sum.amount)
    const count = totals._count

    return {
      answerKey: 'answer.contributionsTotal',
      answerParams: {
        amount: toWire(total),
        count,
        from: period.from.toISOString().slice(0, 10),
        to: period.to.toISOString().slice(0, 10),
      },
      figures: [
        { labelKey: 'figure.contributions.total', value: toWire(total), type: 'money' },
        { labelKey: 'figure.contributions.count', value: String(count), type: 'number' },
      ],
      href: '/contributions',
      snapshot: { period: period.label, total: toWire(total), count },
    }
  },
})

/**
 * The whole catalogue, in the order a help list reads best.
 *
 * Adding a tool is adding an entry here, and the two things it must carry are a permission and a
 * query. There is deliberately no mechanism for a tool that writes.
 */
export const ASSISTANT_TOOLS: readonly AssistantTool[] = [
  countMembers,
  membersWithoutPhone,
  contributionsTotal,
  financeBalance,
  financeFlows,
  topExpenseCategories,
  lowStockProducts,
  stockOnHand,
  salesTotal,
  outstandingFromBuyers,
  nextMeeting,
  openDecisions,
]

/** The tools this caller may use. Built before a question is looked at. */
export function toolsFor(ctx: RequestContext): readonly AssistantTool[] {
  return ASSISTANT_TOOLS.filter((tool) => ctx.permissions.has(tool.permission))
}

export function toolByKey(key: string): AssistantTool | undefined {
  return ASSISTANT_TOOLS.find((tool) => tool.key === key)
}
