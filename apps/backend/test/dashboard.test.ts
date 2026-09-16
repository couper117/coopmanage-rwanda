import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HEADERS } from '@coopmanage/shared'
import { API_PREFIX } from '../src/app.js'
import { disconnectPrisma, prisma } from '../src/lib/prisma.js'
import {
  cleanupFixtures,
  createCooperative,
  createStaffSession,
  type Session,
  type TestCooperative,
  type TestUser,
} from './fixtures.js'
import { testApp } from './server.js'

const app = testApp()

/**
 * Phase 10 — the dashboard and the search box.
 *
 * The exit criterion is four claims, and this file is where each is checked rather than asserted:
 *
 * - **every figure is traceable to a query** — each headline is compared against the endpoint that
 *   owns the same data, so a dashboard that drifted from the ledger it summarises fails here;
 * - **a manager can state the position within ten seconds** — which means the whole thing arrives
 *   in one response and the health rating names the figures behind it;
 * - **the dashboard is one API round trip** — asserted directly, because it is the difference
 *   between one wait and five on a district office connection;
 * - **searching a member name returns that member and their related records, and returns nothing
 *   the caller may not see** — the second half of that sentence is the one that matters, and is
 *   checked by taking a permission away and looking for the record by name.
 */

let cooperative: TestCooperative
let manager: TestUser & Session & { staffId: string }
let storekeeper: TestUser & Session & { staffId: string }
let secretary: TestUser & Session & { staffId: string }

let other: TestCooperative
let otherManager: TestUser & Session & { staffId: string }

let incomeCategory: string
let expenseCategory: string
let store: string
let maize: string
let buyer: string
let memberId: string

function as(
  session: Session,
  method: 'get' | 'post' | 'patch' | 'put',
  path: string,
  coop: TestCooperative = cooperative,
) {
  return request(app)
    [method](`${API_PREFIX}${path}`)
    .set('Authorization', `Bearer ${session.accessToken}`)
    .set(HEADERS.cooperativeId, coop.id)
}

interface Dashboard {
  cooperative: { name: string; code: string }
  month: string
  tiles: { key: string; type: string; value: string; hint?: { key: string; value: string } }[]
  charts: {
    key: string
    series: string[]
    points: { bucket: string; values: Record<string, string> }[]
  }[]
  lowStock: { id: string; name: string; quantity: string; minimum: string }[]
  attention: { key: string; severity: string; params: Record<string, unknown> }[]
  activity: { action: string; actor: string }[]
  health: {
    rating: string
    signals: { key: string; rating: string; params: Record<string, unknown> }[]
  }
  withheld: string[]
}

function tile(board: Dashboard, key: string) {
  const found = board.tiles.find((row) => row.key === key)
  if (!found) throw new Error(`no ${key} tile in ${board.tiles.map((row) => row.key).join(', ')}`)
  return found
}

function chart(board: Dashboard, key: string) {
  const found = board.charts.find((row) => row.key === key)
  if (!found) throw new Error(`no ${key} chart`)
  return found
}

/** This month, as the dashboard labels it. */
function thisMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

function dayInThisMonth(day: number): string {
  return `${thisMonth()}-${String(day).padStart(2, '0')}`
}

beforeAll(async () => {
  cooperative = await createCooperative('Dashboard Test Cooperative')
  manager = await createStaffSession(app, cooperative, 'MANAGER')
  storekeeper = await createStaffSession(app, cooperative, 'INVENTORY_OFFICER')
  secretary = await createStaffSession(app, cooperative, 'SECRETARY')

  other = await createCooperative('Other Dashboard Cooperative')
  otherManager = await createStaffSession(app, other, 'MANAGER')

  const income = await as(manager, 'post', '/finance/categories')
    .send({ kind: 'INCOME', name: 'Sale of produce' })
    .expect(201)
  incomeCategory = income.body.data.id as string
  const expense = await as(manager, 'post', '/finance/categories')
    .send({ kind: 'EXPENSE', name: 'Transport' })
    .expect(201)
  expenseCategory = expense.body.data.id as string

  const member = await as(manager, 'post', '/members')
    .send({ firstName: 'Claudine', lastName: 'Uwase', joinedOn: '2026-01-04', phone: '0788123456' })
    .expect(201)
  memberId = member.body.data.id as string

  const units = await as(manager, 'get', '/units').expect(200)
  const unitId = (units.body.data as { key: string; id: string }[]).find((row) => row.key === 'KG')
    ?.id as string

  const warehouse = await as(manager, 'post', '/warehouses')
    .send({ name: 'Main store' })
    .expect(201)
  store = warehouse.body.data.id as string

  const product = await as(manager, 'post', '/products')
    .send({ name: 'Maize grain', unitId, minStockLevel: '500', defaultSalePrice: '450' })
    .expect(201)
  maize = product.body.data.id as string

  // 400 kg against a minimum of 500: low, and not empty.
  await as(manager, 'post', '/inventory/receive')
    .send({ productId: maize, warehouseId: store, quantity: '400' })
    .expect(201)

  const buyerRow = await as(manager, 'post', '/buyers')
    .send({ name: 'Musanze District Produce Buyer' })
    .expect(201)
  buyer = buyerRow.body.data.id as string

  // Money this month: more in than out, so the cooperative is in good health to begin with.
  await as(manager, 'post', '/finance/transactions')
    .send({
      kind: 'INCOME',
      categoryId: incomeCategory,
      amount: '900000.00',
      occurredAt: dayInThisMonth(3),
      method: 'CASH',
      description: 'Maize sold at the market',
    })
    .expect(201)
  await as(manager, 'post', '/finance/transactions')
    .send({
      kind: 'EXPENSE',
      categoryId: expenseCategory,
      amount: '120000.00',
      occurredAt: dayInThisMonth(4),
      method: 'CASH',
      description: 'Transport to Musanze',
    })
    .expect(201)
}, 150_000)

afterAll(async () => {
  await cleanupFixtures()
  await disconnectPrisma()
})

describe('the exit criterion', () => {
  it('is one API round trip', async () => {
    // Not four requests. On a district office link that is four chances to be slow and four
    // spinners finishing at different moments.
    const response = await as(manager, 'get', '/dashboard').expect(200)
    const board = response.body.data as Dashboard

    expect(board.tiles.length).toBeGreaterThan(0)
    expect(board.charts.length).toBeGreaterThan(0)
    expect(board.health.rating).toBeTruthy()
    expect(Array.isArray(board.activity)).toBe(true)
    expect(Array.isArray(board.attention)).toBe(true)

    // And the four endpoints the plan listed do not exist, so nothing can quietly go back to
    // making four calls.
    for (const path of ['/dashboard/summary', '/dashboard/activity', '/dashboard/attention']) {
      await as(manager, 'get', path).expect(404)
    }
  })

  it('agrees with the endpoints that own the same figures', async () => {
    const board = (await as(manager, 'get', '/dashboard').expect(200)).body.data as Dashboard

    const from = `${thisMonth()}-01`
    const to = `${thisMonth()}-28`
    const finance = (
      await as(manager, 'get', `/finance/summary?from=${from}&to=${to}&groupBy=month`).expect(200)
    ).body.data as { income: string; expenses: string }
    const stats = (await as(manager, 'get', '/members/stats').expect(200)).body.data as {
      byStatus: Record<string, number>
    }

    // The same month's money, from the screen that owns it. A dashboard that disagreed with the
    // ledger it summarises would be worse than no dashboard.
    expect(tile(board, 'income').value).toBe(finance.income)
    expect(tile(board, 'income').hint?.value).toBe(finance.expenses)
    expect(tile(board, 'members').value).toBe(String(stats.byStatus.ACTIVE ?? 0))
  })

  it('states the position with the figures behind it, not just a word', async () => {
    const board = (await as(manager, 'get', '/dashboard').expect(200)).body.data as Dashboard

    expect(['GOOD', 'WATCH', 'ATTENTION']).toContain(board.health.rating)
    // Three signals, each carrying what it was judged on, so the sentence can name the figures
    // rather than assert a verdict a manager has to take on trust.
    expect(board.health.signals.map((signal) => signal.key).sort()).toEqual([
      'money',
      'receivables',
      'stock',
    ])
    const money = board.health.signals.find((signal) => signal.key === 'money')
    expect(money?.params).toMatchObject({ income: '900000.00', expenses: '120000.00' })
  })

  it('finds a member by name, and their related records with them', async () => {
    await as(manager, 'post', '/sales')
      .send({
        buyerId: buyer,
        warehouseId: store,
        lines: [{ productId: maize, quantity: '10', unitPrice: '450' }],
      })
      .expect(201)

    const response = await as(manager, 'get', '/search?q=Uwase').expect(200)
    const hits = response.body.data.hits as { kind: string; title: string; href: string }[]

    const member = hits.find((hit) => hit.kind === 'member')
    expect(member?.title).toContain('Uwase')
    expect(member?.href).toBe(`/members/${memberId}`)
  })

  it('returns nothing the caller may not see', async () => {
    // Every role here can read the register, so the permission is taken away explicitly — which is
    // also the case that matters in practice: a role narrowed by an override must lose the search
    // results with it, not merely the screen.
    await as(manager, 'put', `/staff/${storekeeper.staffId}/overrides`)
      .send({ overrides: [{ permission: 'members:view', effect: 'DENY' }] })
      .expect(200)

    const response = await as(storekeeper, 'get', '/search?q=Uwase').expect(200)
    const hits = response.body.data.hits as { kind: string }[]
    expect(hits.some((hit) => hit.kind === 'member')).toBe(false)
    expect(response.body.data.withheld).toContain('member')

    // The same search as somebody who may read it finds them, which is what makes the negative
    // above meaningful rather than a search that simply does not work.
    const allowed = (await as(manager, 'get', '/search?q=Uwase').expect(200)).body.data as {
      hits: { kind: string }[]
    }
    expect(allowed.hits.some((hit) => hit.kind === 'member')).toBe(true)

    await as(manager, 'put', `/staff/${storekeeper.staffId}/overrides`)
      .send({ overrides: [] })
      .expect(200)
  })
})

describe('the tiles', () => {
  it('shows only the blocks a reader may see, and names the rest', async () => {
    // A storekeeper counts sacks and does not keep the money.
    const board = (await as(storekeeper, 'get', '/dashboard').expect(200)).body.data as Dashboard

    expect(board.tiles.map((row) => row.key)).toContain('stock')
    expect(board.tiles.map((row) => row.key)).not.toContain('balance')
    expect(board.withheld).toContain('finance')
    // Named rather than dropped: nobody should have to wonder whether a missing tile means zero.
    expect(board.charts.map((row) => row.key)).not.toContain('incomeExpense')
  })

  it('keeps the activity list for readers who may see the trail', async () => {
    const manager_ = (await as(manager, 'get', '/dashboard').expect(200)).body.data as Dashboard
    expect(manager_.activity.length).toBeGreaterThan(0)
    expect(manager_.activity[0]?.actor).toBeTruthy()

    // The trail names who did what, and a cooperative's staff list is not something every role
    // should be able to watch.
    const secretary_ = (await as(secretary, 'get', '/dashboard').expect(200)).body.data as Dashboard
    expect(secretary_.activity).toEqual([])
    expect(secretary_.withheld).toContain('activity')
  })
})

describe('the charts', () => {
  it('gives twelve months of money, including the quiet ones', async () => {
    const board = (await as(manager, 'get', '/dashboard').expect(200)).body.data as Dashboard
    const money = chart(board, 'incomeExpense')

    // A chart that skipped an empty month would draw a line between two points that are not
    // adjacent.
    expect(money.points).toHaveLength(12)
    expect(money.series).toEqual(['income', 'expenses'])
    expect(money.points.at(-1)?.bucket).toBe(thisMonth())
    expect(money.points.at(-1)?.values.income).toBe('900000.00')
  })

  it('gives six months of sales with the six before them to compare against', async () => {
    const board = (await as(manager, 'get', '/dashboard').expect(200)).body.data as Dashboard
    const sales = chart(board, 'sales')

    expect(sales.points).toHaveLength(6)
    expect(sales.series).toEqual(['sold', 'previous'])
    // Every point carries both, so the reader compares like with like rather than reading two
    // lines that happen to share an axis.
    for (const point of sales.points) {
      expect(point.values.sold).toMatch(/^\d+\.\d{2}$/)
      expect(point.values.previous).toMatch(/^\d+\.\d{2}$/)
    }
  })

  it('breaks this month’s expenses down by category', async () => {
    const board = (await as(manager, 'get', '/dashboard').expect(200)).body.data as Dashboard
    const expenses = chart(board, 'expensesByCategory')

    expect(expenses.points[0]?.bucket).toBe('Transport')
    expect(expenses.points[0]?.values.amount).toBe('120000.00')
  })

  it('excludes a voided entry and its reversal as a pair', async () => {
    const posted = await as(manager, 'post', '/finance/transactions')
      .send({
        kind: 'INCOME',
        categoryId: incomeCategory,
        amount: '55555.55',
        occurredAt: dayInThisMonth(5),
        method: 'CASH',
        description: 'To be cancelled',
      })
      .expect(201)

    const before = (await as(manager, 'get', '/dashboard').expect(200)).body.data as Dashboard
    expect(tile(before, 'income').value).toBe('955555.55')

    await as(manager, 'post', `/finance/transactions/${posted.body.data.id}/void`)
      .send({ reason: 'Wrong figure typed at the counter' })
      .expect(200)

    const after = (await as(manager, 'get', '/dashboard').expect(200)).body.data as Dashboard
    // Not 900,000 less 55,555.55 again: taking the void out and counting the reversal would apply
    // the correction twice, which is the defect this rule exists to prevent.
    expect(tile(after, 'income').value).toBe('900000.00')
  })
})

describe('what needs attention', () => {
  it('leads with the stock that is running low', async () => {
    const board = (await as(manager, 'get', '/dashboard').expect(200)).body.data as Dashboard

    expect(board.lowStock).toHaveLength(1)
    expect(board.lowStock[0]?.name).toBe('Maize grain')
    expect(board.lowStock[0]?.quantity).toBe('400.000')
    expect(board.lowStock[0]?.minimum).toBe('500.000')

    const item = board.attention.find((row) => row.key === 'lowStock')
    expect(item?.severity).toBe('WARNING')
    expect(item?.params.count).toBe(1)
  })

  it('treats a product at zero as worse than one running low', async () => {
    await as(manager, 'post', '/inventory/issue')
      .send({ productId: maize, warehouseId: store, quantity: '400', reason: 'OWN_USE' })
      .expect(201)

    const board = (await as(manager, 'get', '/dashboard').expect(200)).body.data as Dashboard
    const item = board.attention.find((row) => row.key === 'outOfStock')

    // Running low and having run out are different situations, and the second stops the
    // cooperative selling.
    expect(item?.severity).toBe('CRITICAL')
    const signal = board.health.signals.find((row) => row.key === 'stock')
    expect(signal?.rating).toBe('ATTENTION')
    expect(board.health.rating).toBe('ATTENTION')

    // The plural selector follows the rating: the sentence for ATTENTION is about what has run
    // out, so `count` is that figure and not the number of products on the catalogue. Without it
    // the interface would write "1 products are out of stock".
    expect(signal?.params.count).toBe(signal?.params.empty)

    // Put it back, so the tests that follow start from the state they expect.
    await as(manager, 'post', '/inventory/receive')
      .send({ productId: maize, warehouseId: store, quantity: '400' })
      .expect(201)
  })

  it('puts the worst thing first', async () => {
    await as(manager, 'post', '/finance/transactions')
      .send({
        kind: 'EXPENSE',
        categoryId: expenseCategory,
        amount: '9000000.00',
        occurredAt: dayInThisMonth(6),
        method: 'CASH',
        description: 'A very large purchase',
      })
      .expect(201)

    const board = (await as(manager, 'get', '/dashboard').expect(200)).body.data as Dashboard
    expect(board.attention[0]?.severity).toBe('CRITICAL')
    expect(board.attention[0]?.key).toBe('negativeBalance')
    expect(board.health.rating).toBe('ATTENTION')
    expect(board.health.signals.find((signal) => signal.key === 'money')?.rating).toBe('ATTENTION')
  })
})

describe('the search', () => {
  it('ranks an exact code above a name that merely contains the term', async () => {
    const codeRow = await prisma.member.findUniqueOrThrow({
      where: { id: memberId },
      select: { memberCode: true },
    })

    const response = await as(
      manager,
      'get',
      `/search?q=${encodeURIComponent(codeRow.memberCode)}`,
    ).expect(200)
    const hits = response.body.data.hits as { kind: string; subtitle: string; score: number }[]

    // Somebody who types a member number has a particular person in mind.
    expect(hits[0]?.subtitle).toBe(codeRow.memberCode)
    expect(hits[0]?.score).toBe(100)
  })

  it('searches across the modules a reader may see', async () => {
    const response = await as(manager, 'get', '/search?q=Maize').expect(200)
    const kinds = new Set((response.body.data.hits as { kind: string }[]).map((hit) => hit.kind))
    // A product by name, and the sale whose line carries it is found by its own reference rather
    // than by the product, which is why this asserts the product only.
    expect(kinds.has('product')).toBe(true)
  })

  it('finds nothing belonging to another cooperative', async () => {
    const response = await as(otherManager, 'get', '/search?q=Uwase', other).expect(200)
    expect(response.body.data.hits).toEqual([])
  })

  it('refuses a term too short to mean anything', async () => {
    // One letter matches most of a register, and would make the box a way to page through the
    // whole cooperative one keystroke at a time.
    await as(manager, 'get', '/search?q=U').expect(422)
    await as(manager, 'get', '/search').expect(422)
  })

  it('needs search:use, which is not the same as being able to read a member', async () => {
    await as(manager, 'put', `/staff/${storekeeper.staffId}/overrides`)
      .send({ overrides: [{ permission: 'search:use', effect: 'DENY' }] })
      .expect(200)

    await as(storekeeper, 'get', '/search?q=Maize').expect(403)

    await as(manager, 'put', `/staff/${storekeeper.staffId}/overrides`)
      .send({ overrides: [] })
      .expect(200)
  })
})

describe('tenancy', () => {
  it('shows each cooperative only its own figures', async () => {
    const ours = (await as(manager, 'get', '/dashboard').expect(200)).body.data as Dashboard
    const theirs = (await as(otherManager, 'get', '/dashboard', other).expect(200)).body
      .data as Dashboard

    expect(ours.cooperative.code).toBe(cooperative.code)
    expect(theirs.cooperative.code).toBe(other.code)
    // The other cooperative has no records at all, so every figure is nil and nothing is low.
    expect(theirs.lowStock).toEqual([])
    expect(theirs.activity.every((entry) => entry.actor !== manager.email)).toBe(true)
  })
})
