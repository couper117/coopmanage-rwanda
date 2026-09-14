import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HEADERS } from '@coopmanage/shared'
import { API_PREFIX } from '../src/app.js'
import { Decimal } from '../src/lib/money.js'
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

let cooperative: TestCooperative
let manager: TestUser & Session & { staffId: string }
let accountant: TestUser & Session & { staffId: string }
let secretary: TestUser & Session & { staffId: string }
let viewer: TestUser & Session & { staffId: string }
let income: string
let income2: string
let expense: string

function as(
  session: Session,
  method: 'get' | 'post' | 'patch',
  path: string,
  coop: TestCooperative = cooperative,
) {
  return request(app)
    [method](`${API_PREFIX}${path}`)
    .set('Authorization', `Bearer ${session.accessToken}`)
    .set(HEADERS.cooperativeId, coop.id)
}

async function makeCategory(
  cooperativeId: string,
  kind: 'INCOME' | 'EXPENSE',
  name: string,
): Promise<string> {
  const row = await prisma.financeCategory.create({
    data: { cooperativeId, kind, name, isSystem: false },
    select: { id: true },
  })
  return row.id
}

/** Records an entry and returns its identifier and reference. */
async function post(
  body: Record<string, unknown>,
  session: Session = accountant,
): Promise<{ id: string; reference: string; amount: string }> {
  const response = await as(session, 'post', '/finance/transactions')
    .send({
      kind: 'INCOME',
      categoryId: income,
      amount: '1000',
      method: 'CASH',
      description: 'Entry',
      ...body,
    })
    .expect(201)
  return response.body.data as { id: string; reference: string; amount: string }
}

beforeAll(async () => {
  cooperative = await createCooperative('Finance Test Cooperative')
  manager = await createStaffSession(app, cooperative, 'MANAGER')
  accountant = await createStaffSession(app, cooperative, 'ACCOUNTANT')
  secretary = await createStaffSession(app, cooperative, 'SECRETARY')
  viewer = await createStaffSession(app, cooperative, 'VIEWER')
  income = await makeCategory(cooperative.id, 'INCOME', 'Sale of produce')
  income2 = await makeCategory(cooperative.id, 'INCOME', 'Grants and support')
  expense = await makeCategory(cooperative.id, 'EXPENSE', 'Transport')
}, 60_000)

afterAll(async () => {
  await cleanupFixtures()
  await disconnectPrisma()
})

describe('recording an entry', () => {
  it('stores the amount exactly as it was typed', async () => {
    const entry = await post({ amount: '12345.67', description: 'Sale of beans' })
    expect(entry.amount).toBe('12345.67')
    expect(typeof entry.amount).toBe('string')

    const stored = await prisma.financeTransaction.findUniqueOrThrow({
      where: { id: entry.id },
      select: { amount: true },
    })
    // The database holds a decimal, not a float, so the figure stored is the figure typed.
    expect(stored.amount.toString()).toBe('12345.67')
  })

  it('allocates a readable reference per cooperative and year', async () => {
    const entry = await post({ amount: '500', occurredAt: '2026-03-04' })
    expect(entry.reference).toMatch(/^IN-2026-\d{6}$/)

    const out = await post({ kind: 'EXPENSE', categoryId: expense, amount: '500' })
    expect(out.reference).toMatch(/^EX-\d{4}-\d{6}$/)
  })

  it('refuses an amount with more decimal places than the column holds', async () => {
    // Rounding it would mean the figure stored is not the figure typed, which is the whole reason
    // this system does not use floats.
    await as(accountant, 'post', '/finance/transactions')
      .send({
        kind: 'INCOME',
        categoryId: income,
        amount: '100.005',
        method: 'CASH',
        description: 'x',
      })
      .expect(422)
  })

  it('refuses zero, a negative amount and something that is not a number', async () => {
    for (const amount of ['0', '-100', 'one thousand', '']) {
      await as(accountant, 'post', '/finance/transactions')
        .send({ kind: 'INCOME', categoryId: income, amount, method: 'CASH', description: 'x' })
        .expect(422)
    }
  })

  it('refuses a category of the wrong kind', async () => {
    // An expense category on an income entry would put the money on the wrong side of the balance
    // without the amount ever being wrong.
    await as(accountant, 'post', '/finance/transactions')
      .send({
        kind: 'INCOME',
        categoryId: expense,
        amount: '1000',
        method: 'CASH',
        description: 'x',
      })
      .expect(422)
  })

  it('refuses a member belonging to another cooperative', async () => {
    const other = await createCooperative('Foreign Finance Cooperative')
    const foreign = await prisma.member.create({
      data: {
        cooperativeId: other.id,
        memberCode: 'FOR-00001',
        firstName: 'Foreign',
        lastName: 'Member',
        joinedOn: new Date('2026-01-01T00:00:00.000Z'),
      },
      select: { id: true },
    })

    await as(accountant, 'post', '/finance/transactions')
      .send({
        kind: 'EXPENSE',
        categoryId: expense,
        amount: '1000',
        method: 'CASH',
        description: 'Payment',
        memberId: foreign.id,
      })
      .expect(422)
  })

  it('defaults the date to today and keeps the one it is given', async () => {
    const today = await post({ amount: '1000' })
    const detail = await as(manager, 'get', `/finance/transactions/${today.id}`).expect(200)
    expect(detail.body.data.occurredAt).toBe(new Date().toISOString().slice(0, 10))

    const dated = await post({ amount: '1000', occurredAt: '2026-01-15' })
    const backdated = await as(manager, 'get', `/finance/transactions/${dated.id}`).expect(200)
    // The accounting date is the day the money moved, not the day somebody typed it in.
    expect(backdated.body.data.occurredAt).toBe('2026-01-15')
  })

  it('records who entered it in the audit trail', async () => {
    const entry = await post({ amount: '2500' })
    const log = await prisma.auditLog.findFirst({
      where: { entityId: entry.id, action: 'finance.transaction.posted' },
    })
    expect(log).not.toBeNull()
    expect(log?.actorLabel).toContain(accountant.email)
  })

  it('lets an accountant record but refuses a secretary and a viewer', async () => {
    await as(accountant, 'post', '/finance/transactions')
      .send({ kind: 'INCOME', categoryId: income, amount: '100', method: 'CASH', description: 'x' })
      .expect(201)
    for (const session of [secretary, viewer]) {
      await as(session, 'post', '/finance/transactions')
        .send({
          kind: 'INCOME',
          categoryId: income,
          amount: '100',
          method: 'CASH',
          description: 'x',
        })
        .expect(403)
    }
  })

  it('hides the whole module from a secretary, who holds no finance permission', async () => {
    await as(secretary, 'get', '/finance/transactions').expect(403)
    await as(secretary, 'get', '/finance/categories').expect(403)
  })
})

describe('the same request sent twice', () => {
  /** The Phase 5 exit criterion. A treasurer on a slow connection presses Record twice. */
  it('creates exactly one entry for a repeated retry key', async () => {
    const key = randomUUID()
    const body = {
      kind: 'INCOME',
      categoryId: income,
      amount: '50000',
      method: 'MOBILE_MONEY',
      description: `Idempotent sale ${key}`,
    }

    const first = await as(accountant, 'post', '/finance/transactions')
      .set(HEADERS.idempotencyKey, key)
      .send(body)
      .expect(201)
    const second = await as(accountant, 'post', '/finance/transactions')
      .set(HEADERS.idempotencyKey, key)
      .send(body)
      .expect(201)

    // The same receipt back, not a second one.
    expect(second.body.data.id).toBe(first.body.data.id)
    expect(second.body.data.reference).toBe(first.body.data.reference)

    const rows = await prisma.financeTransaction.count({
      where: { cooperativeId: cooperative.id, description: body.description },
    })
    expect(rows).toBe(1)
  })

  it('refuses the same key used for a different request', async () => {
    const key = randomUUID()
    await as(accountant, 'post', '/finance/transactions')
      .set(HEADERS.idempotencyKey, key)
      .send({
        kind: 'INCOME',
        categoryId: income,
        amount: '1000',
        method: 'CASH',
        description: 'First',
      })
      .expect(201)

    // Answering this with the first entry's receipt would tell the user their second, different
    // entry was recorded when it was not.
    const response = await as(accountant, 'post', '/finance/transactions')
      .set(HEADERS.idempotencyKey, key)
      .send({
        kind: 'INCOME',
        categoryId: income,
        amount: '9999',
        method: 'CASH',
        description: 'Second',
      })
      .expect(409)
    expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  it('lets a corrected request through on the same key after the first was refused', async () => {
    const key = randomUUID()
    const description = `Corrected after a refusal ${key}`

    // The first attempt names an expense category on an income entry, so it is refused and
    // nothing is recorded.
    await as(accountant, 'post', '/finance/transactions')
      .set(HEADERS.idempotencyKey, key)
      .send({ kind: 'INCOME', categoryId: expense, amount: '1000', method: 'CASH', description })
      .expect(422)

    // The user fixes the category and presses Record again, which sends the same key. Holding the
    // claim over work that never happened would answer this with "still being processed" for the
    // next twenty-four hours.
    const fixed = await as(accountant, 'post', '/finance/transactions')
      .set(HEADERS.idempotencyKey, key)
      .send({ kind: 'INCOME', categoryId: income, amount: '1000', method: 'CASH', description })
      .expect(201)
    expect(fixed.body.data.amount).toBe('1000.00')

    const rows = await prisma.financeTransaction.count({
      where: { cooperativeId: cooperative.id, description },
    })
    expect(rows).toBe(1)
  })

  it('records two identical entries when no retry key is sent', async () => {
    const body = {
      kind: 'INCOME',
      categoryId: income,
      amount: '3000',
      method: 'CASH',
      description: `Twice on purpose ${randomUUID()}`,
    }
    await as(accountant, 'post', '/finance/transactions').send(body).expect(201)
    await as(accountant, 'post', '/finance/transactions').send(body).expect(201)

    // Two members paying the same amount for the same thing on the same day is ordinary, so
    // without a key the second entry must not be swallowed.
    const rows = await prisma.financeTransaction.count({
      where: { cooperativeId: cooperative.id, description: body.description },
    })
    expect(rows).toBe(2)
  })

  it("keeps one cooperative's keys clear of another's", async () => {
    const other = await createCooperative('Idempotent Other Cooperative')
    const otherManager = await createStaffSession(app, other, 'MANAGER')
    const otherCategory = await makeCategory(other.id, 'INCOME', 'Sale of produce')
    const key = randomUUID()

    await as(accountant, 'post', '/finance/transactions')
      .set(HEADERS.idempotencyKey, key)
      .send({
        kind: 'INCOME',
        categoryId: income,
        amount: '1000',
        method: 'CASH',
        description: 'Mine',
      })
      .expect(201)
    // The key is scoped to the cooperative, so two cooperatives cannot collide.
    await as(otherManager, 'post', '/finance/transactions', other)
      .set(HEADERS.idempotencyKey, key)
      .send({
        kind: 'INCOME',
        categoryId: otherCategory,
        amount: '2000',
        method: 'CASH',
        description: 'Theirs',
      })
      .expect(201)
  })
})

describe('correcting an entry', () => {
  it('changes the category and the description, and nothing else', async () => {
    const entry = await post({ amount: '4000', description: 'Typo here' })
    const response = await as(accountant, 'patch', `/finance/transactions/${entry.id}`)
      .send({ description: 'Sale of maize', categoryId: income2 })
      .expect(200)

    expect(response.body.data.description).toBe('Sale of maize')
    expect(response.body.data.categoryId).toBe(income2)
    expect(response.body.data.amount).toBe('4000.00')
  })

  it('refuses to edit the amount, the kind or the date', async () => {
    const entry = await post({ amount: '4000' })
    for (const body of [{ amount: '9999' }, { kind: 'EXPENSE' }, { occurredAt: '2020-01-01' }]) {
      // A posted figure can never change, because a report printed last month has to still be
      // true. Corrections go through a reversal.
      await as(accountant, 'patch', `/finance/transactions/${entry.id}`).send(body).expect(422)
    }
  })

  it('refuses to move an entry to a category of the other kind', async () => {
    const entry = await post({ amount: '4000' })
    await as(accountant, 'patch', `/finance/transactions/${entry.id}`)
      .send({ categoryId: expense })
      .expect(422)
  })

  it('refuses an empty patch', async () => {
    const entry = await post({ amount: '4000' })
    await as(accountant, 'patch', `/finance/transactions/${entry.id}`).send({}).expect(422)
  })
})

describe('voiding', () => {
  /** The Phase 5 exit criterion: both rows in the history, and the balance back where it was. */
  it('writes a reversal, keeps both rows and returns the balance to its prior value', async () => {
    const before = await as(manager, 'get', '/finance/transactions?pageSize=1').expect(200)
    const startingBalance = before.body.meta.totals.balance as string

    const entry = await post({ amount: '77777.77', description: 'Recorded in error' })
    const during = await as(manager, 'get', '/finance/transactions?pageSize=1').expect(200)
    expect(during.body.meta.totals.balance).not.toBe(startingBalance)

    const voided = await as(accountant, 'post', `/finance/transactions/${entry.id}/void`)
      .send({ reason: 'Entered against the wrong cooperative' })
      .expect(200)

    expect(voided.body.data.voided.reference).toBe(entry.reference)
    expect(voided.body.data.reversal.reference).toMatch(/^EX-\d{4}-\d{6}$/)
    expect(voided.body.data.reversal.amount).toBe('77777.77')

    const after = await as(manager, 'get', '/finance/transactions?pageSize=1').expect(200)
    expect(after.body.meta.totals.balance).toBe(startingBalance)

    // Nothing was deleted. The mistake and its correction are both part of the record.
    const original = await prisma.financeTransaction.findUniqueOrThrow({
      where: { id: entry.id },
      select: { status: true, voidReason: true, voidedAt: true },
    })
    expect(original.status).toBe('VOID')
    expect(original.voidReason).toBe('Entered against the wrong cooperative')
    expect(original.voidedAt).not.toBeNull()

    const reversal = await prisma.financeTransaction.findFirstOrThrow({
      where: { reversalOfId: entry.id },
      select: { kind: true, occurredAt: true, status: true },
    })
    expect(reversal.kind).toBe('EXPENSE')
    expect(reversal.status).toBe('POSTED')
  })

  it('gives the reversal the original accounting date', async () => {
    const entry = await post({ amount: '1000', occurredAt: '2026-02-10' })
    await as(accountant, 'post', `/finance/transactions/${entry.id}/void`).send({}).expect(200)

    const reversal = await prisma.financeTransaction.findFirstOrThrow({
      where: { reversalOfId: entry.id },
      select: { occurredAt: true },
    })
    // A correction must not move money between periods that have already been reported on.
    expect(reversal.occurredAt.toISOString().slice(0, 10)).toBe('2026-02-10')
  })

  it('names both sides of the correction from either end', async () => {
    const entry = await post({ amount: '1000', description: 'Two-sided' })
    const voided = await as(accountant, 'post', `/finance/transactions/${entry.id}/void`)
      .send({})
      .expect(200)
    const reversalId = voided.body.data.reversal.id as string

    const original = await as(manager, 'get', `/finance/transactions/${entry.id}`).expect(200)
    const reversal = await as(manager, 'get', `/finance/transactions/${reversalId}`).expect(200)

    expect(original.body.data.reversedByReference).toBe(voided.body.data.reversal.reference)
    expect(reversal.body.data.reversalOfReference).toBe(entry.reference)
  })

  it('refuses to void the same entry twice', async () => {
    const entry = await post({ amount: '1000' })
    await as(accountant, 'post', `/finance/transactions/${entry.id}/void`).send({}).expect(200)
    await as(accountant, 'post', `/finance/transactions/${entry.id}/void`).send({}).expect(409)
  })

  it('refuses to edit an entry once it is void', async () => {
    const entry = await post({ amount: '1000' })
    await as(accountant, 'post', `/finance/transactions/${entry.id}/void`).send({}).expect(200)
    const response = await as(accountant, 'patch', `/finance/transactions/${entry.id}`)
      .send({ description: 'Tidying up' })
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.finance.voidedNotEditable')
  })

  it('sends a contribution back to the member record to be cancelled', async () => {
    const member = await prisma.member.create({
      data: {
        cooperativeId: cooperative.id,
        memberCode: 'FIN-00001',
        firstName: 'Pays',
        lastName: 'Afee',
        joinedOn: new Date('2026-01-01T00:00:00.000Z'),
      },
      select: { id: true },
    })
    const contribution = await as(accountant, 'post', `/members/${member.id}/contributions`)
      .send({ type: 'MEMBERSHIP_FEE', amount: '5000', method: 'CASH', categoryId: income })
      .expect(201)

    const ledgerRow = await prisma.contribution.findUniqueOrThrow({
      where: { id: contribution.body.data.id as string },
      select: { financeTransactionId: true },
    })

    // The ledger row and the member's record are two views of the same money. Voiding only the
    // ledger side would leave the member's history claiming money the books no longer hold.
    const response = await as(
      accountant,
      'post',
      `/finance/transactions/${ledgerRow.financeTransactionId as string}/void`,
    )
      .send({})
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.finance.voidFromSource')
  })

  it('needs finance:void, which a manager holds and a viewer does not', async () => {
    const entry = await post({ amount: '1000' })
    await as(viewer, 'post', `/finance/transactions/${entry.id}/void`).send({}).expect(403)
    await as(manager, 'post', `/finance/transactions/${entry.id}/void`).send({}).expect(200)
  })
})

describe('the ledger', () => {
  it('totals the whole filter, not the page on screen', async () => {
    const response = await as(manager, 'get', '/finance/transactions?pageSize=2').expect(200)
    expect(response.body.data.length).toBeLessThanOrEqual(2)
    expect(response.body.meta.total).toBeGreaterThan(2)
    expect(response.body.meta.totals.income).toMatch(/^\d+\.\d{2}$/)
    expect(response.body.meta.totals.expenses).toMatch(/^\d+\.\d{2}$/)
    expect(response.body.meta.totals.balance).toMatch(/^-?\d+\.\d{2}$/)
  })

  it('counts only posted rows towards a total', async () => {
    const coop = await createCooperative('Void Totals Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const category = await makeCategory(coop.id, 'INCOME', 'Sale of produce')

    const entry = await as(owner, 'post', '/finance/transactions', coop)
      .send({
        kind: 'INCOME',
        categoryId: category,
        amount: '1000',
        method: 'CASH',
        description: 'x',
      })
      .expect(201)
    await as(owner, 'post', `/finance/transactions/${entry.body.data.id as string}/void`, coop)
      .send({})
      .expect(200)

    const response = await as(owner, 'get', '/finance/transactions', coop).expect(200)
    // The void and its reversal cancel out. Counting the reversal while excluding the void would
    // apply the correction twice, and an early version of this module did exactly that: one
    // cancelled receipt of 1,000 francs took 2,000 off the balance.
    expect(response.body.meta.totals.balance).toBe('0.00')
    expect(response.body.meta.totals.income).toBe('0.00')
    // And the month's income is nil, not 1,000: a receipt that was cancelled is not money the
    // cooperative received.
    expect(response.body.meta.totals.expenses).toBe('0.00')
    // Both rows stay in the listing with their status, which is what makes the correction visible.
    expect(response.body.meta.total).toBe(2)
  })

  it('leaves an untouched entry counted in full', async () => {
    const coop = await createCooperative('Untouched Totals Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const inc = await makeCategory(coop.id, 'INCOME', 'Sale of produce')
    const exp = await makeCategory(coop.id, 'EXPENSE', 'Transport')

    await as(owner, 'post', '/finance/transactions', coop)
      .send({ kind: 'INCOME', categoryId: inc, amount: '10000', method: 'CASH', description: 'in' })
      .expect(201)
    await as(owner, 'post', '/finance/transactions', coop)
      .send({
        kind: 'EXPENSE',
        categoryId: exp,
        amount: '2500.50',
        method: 'CASH',
        description: 'out',
      })
      .expect(201)

    const response = await as(owner, 'get', '/finance/transactions', coop).expect(200)
    expect(response.body.meta.totals.income).toBe('10000.00')
    expect(response.body.meta.totals.expenses).toBe('2500.50')
    expect(response.body.meta.totals.balance).toBe('7499.50')
  })

  it('filters by kind, category, method, status and date', async () => {
    await post({ amount: '1000', occurredAt: '2026-04-01', method: 'BANK' })
    const checks: [string, (row: Record<string, string | undefined>) => boolean][] = [
      ['kind=EXPENSE', (row) => row.kind === 'EXPENSE'],
      [`categoryId=${income}`, (row) => row.categoryId === income],
      ['method=BANK', (row) => row.method === 'BANK'],
      ['status=VOID', (row) => row.status === 'VOID'],
      ['from=2026-04-01&to=2026-04-30', (row) => (row.occurredAt ?? '') >= '2026-04-01'],
    ]

    for (const [query, holds] of checks) {
      const response = await as(manager, 'get', `/finance/transactions?${query}`).expect(200)
      expect(
        (response.body.data as Record<string, string | undefined>[]).every(holds),
        `filter ${query}`,
      ).toBe(true)
    }
  })

  it('reports totals that belong to the rows on screen', async () => {
    const coop = await createCooperative('Footer Totals Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const inc = await makeCategory(coop.id, 'INCOME', 'Sale of produce')

    const entry = await as(owner, 'post', '/finance/transactions', coop)
      .send({
        kind: 'INCOME',
        categoryId: inc,
        amount: '6000',
        method: 'CASH',
        description: 'kept',
      })
      .expect(201)
    await as(owner, 'post', '/finance/transactions', coop)
      .send({
        kind: 'INCOME',
        categoryId: inc,
        amount: '4000',
        method: 'CASH',
        description: 'gone',
      })
      .expect(201)
    await as(owner, 'post', `/finance/transactions/${entry.body.data.id as string}/void`, coop)
      .send({})
      .expect(200)

    const all = await as(owner, 'get', '/finance/transactions', coop).expect(200)
    expect(all.body.meta.totals.income).toBe('4000.00')

    // Filtered to the cancelled entries, the footer has to say nothing rather than showing the
    // total of the entries that still stand.
    const voided = await as(owner, 'get', '/finance/transactions?status=VOID', coop).expect(200)
    expect(voided.body.meta.total).toBe(1)
    expect(voided.body.meta.totals.income).toBe('0.00')
    expect(voided.body.meta.totals.balance).toBe('0.00')
  })

  it('filters on an amount range', async () => {
    const response = await as(
      manager,
      'get',
      '/finance/transactions?minAmount=5000&maxAmount=100000',
    ).expect(200)
    for (const row of response.body.data as { amount: string }[]) {
      expect(new Decimal(row.amount).gte(5000)).toBe(true)
      expect(new Decimal(row.amount).lte(100_000)).toBe(true)
    }
  })

  it('searches the reference and the description', async () => {
    const entry = await post({ amount: '1000', description: 'Distinctive maize purchase' })

    for (const query of ['Distinctive', entry.reference]) {
      const response = await as(
        manager,
        'get',
        `/finance/transactions?q=${encodeURIComponent(query)}`,
      ).expect(200)
      const ids = (response.body.data as { id: string }[]).map((row) => row.id)
      expect(ids, `searching ${query}`).toContain(entry.id)
    }
  })

  it('refuses an unknown filter and an unknown sort', async () => {
    // A typo in a filter must never silently widen the result, and an arbitrary sort field would
    // be a way to probe the schema.
    await as(manager, 'get', '/finance/transactions?kindd=INCOME').expect(422)
    await as(manager, 'get', '/finance/transactions?sort=createdById').expect(422)
  })

  it('refuses a range that runs backwards or covers more than five years', async () => {
    await as(manager, 'get', '/finance/transactions?from=2026-06-01&to=2026-01-01').expect(422)
    await as(manager, 'get', '/finance/transactions?from=2010-01-01&to=2026-01-01').expect(422)
  })

  it('names where an entry came from', async () => {
    const response = await as(manager, 'get', '/finance/transactions?pageSize=100').expect(200)
    const sources = new Set(
      (response.body.data as { sourceType: string }[]).map((row) => row.sourceType),
    )
    // An entry a treasurer typed and one that came from a member's contribution are different
    // things, and the interface has to be able to tell them apart.
    expect(sources.has('MANUAL')).toBe(true)
  })
})

describe('the summary', () => {
  let coop: TestCooperative
  let owner: TestUser & Session & { staffId: string }
  let salesCategory: string
  let transportCategory: string

  beforeAll(async () => {
    coop = await createCooperative('Summary Cooperative')
    owner = await createStaffSession(app, coop, 'MANAGER')
    salesCategory = await makeCategory(coop.id, 'INCOME', 'Sale of produce')
    transportCategory = await makeCategory(coop.id, 'EXPENSE', 'Transport')

    const entries: [string, string, string, string][] = [
      ['INCOME', salesCategory, '100000.00', '2026-01-10'],
      ['INCOME', salesCategory, '50000.00', '2026-01-20'],
      ['EXPENSE', transportCategory, '30000.00', '2026-01-25'],
      ['INCOME', salesCategory, '200000.00', '2026-03-05'],
      ['EXPENSE', transportCategory, '20000.00', '2026-03-08'],
    ]
    for (const [kind, categoryId, amount, occurredAt] of entries) {
      await as(owner, 'post', '/finance/transactions', coop)
        .send({
          kind,
          categoryId,
          amount,
          method: 'CASH',
          description: `${kind} on ${occurredAt}`,
          occurredAt,
        })
        .expect(201)
    }
  }, 60_000)

  it('reports money in, money out and the net for a range', async () => {
    const response = await as(
      owner,
      'get',
      '/finance/summary?from=2026-01-01&to=2026-12-31',
      coop,
    ).expect(200)
    const data = response.body.data

    expect(data.income).toBe('350000.00')
    expect(data.expenses).toBe('50000.00')
    expect(data.net).toBe('300000.00')
  })

  it('carries an opening balance from before the range', async () => {
    const response = await as(
      owner,
      'get',
      '/finance/summary?from=2026-02-01&to=2026-12-31',
      coop,
    ).expect(200)
    const data = response.body.data

    // January closed at 120,000, and February opens there. A period report that started from zero
    // would tell a manager the cooperative had less than it does.
    expect(data.opening).toBe('120000.00')
    expect(data.income).toBe('200000.00')
    expect(data.expenses).toBe('20000.00')
    expect(data.closing).toBe('300000.00')
  })

  it('includes the months with nothing in them', async () => {
    const response = await as(
      owner,
      'get',
      '/finance/summary?from=2026-01-01&to=2026-04-30&groupBy=month',
      coop,
    ).expect(200)
    const buckets = response.body.data.buckets as { start: string; net: string }[]

    expect(buckets.map((row) => row.start)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
    ])
    // A chart that skips an empty month draws a line between two points that are not adjacent,
    // which reads as a trend that did not happen.
    expect(buckets[1]?.net).toBe('0.00')
  })

  it('groups by day and by week as well', async () => {
    const byDay = await as(
      owner,
      'get',
      '/finance/summary?from=2026-01-10&to=2026-01-12&groupBy=day',
      coop,
    ).expect(200)
    expect((byDay.body.data.buckets as unknown[]).length).toBe(3)
    expect((byDay.body.data.buckets as { start: string }[])[0]?.start).toBe('2026-01-10')

    const byWeek = await as(
      owner,
      'get',
      '/finance/summary?from=2026-01-05&to=2026-01-25&groupBy=week',
      coop,
    ).expect(200)
    const weeks = byWeek.body.data.buckets as { start: string }[]
    // Weeks begin on Monday, which is what PostgreSQL does and what a Rwandan working week does.
    expect(weeks.every((row) => new Date(`${row.start}T00:00:00Z`).getUTCDay() === 1)).toBe(true)
  })

  it('breaks the total down by category, as a figure and a share of its own kind', async () => {
    const response = await as(
      owner,
      'get',
      '/finance/summary?from=2026-01-01&to=2026-12-31',
      coop,
    ).expect(200)
    const categories = response.body.data.categories as {
      categoryId: string
      kind: string
      total: string
      share: string
    }[]

    const sales = categories.find((row) => row.categoryId === salesCategory)
    const transport = categories.find((row) => row.categoryId === transportCategory)
    expect(sales?.total).toBe('350000.00')
    expect(transport?.total).toBe('50000.00')
    // The share is of income or of expenses, never of the two combined: 100 % of what came in is
    // a useful sentence, while 87 % of everything that moved is not.
    expect(sales?.share).toBe('100.0')
    expect(transport?.share).toBe('100.0')
  })

  it('requires both ends of the range', async () => {
    // A summary with no range would quietly report a different period than the reader has in mind.
    await as(owner, 'get', '/finance/summary', coop).expect(422)
    await as(owner, 'get', '/finance/summary?from=2026-01-01', coop).expect(422)
  })

  it('carries the balance forward in the trend', async () => {
    const response = await as(
      owner,
      'get',
      '/finance/trends?from=2026-01-01&to=2026-03-31&groupBy=month',
      coop,
    ).expect(200)
    const points = response.body.data.points as { start: string; balance: string }[]

    expect(points.map((row) => row.balance)).toEqual(['120000.00', '120000.00', '300000.00'])
  })

  it("counts only this cooperative's money", async () => {
    const response = await as(
      owner,
      'get',
      '/finance/summary?from=2026-01-01&to=2026-12-31',
      coop,
    ).expect(200)
    // The other cooperatives in this run have hundreds of thousands of francs of their own.
    expect(response.body.data.income).toBe('350000.00')
  })
})

describe('the reported balance against an independent sum', () => {
  /**
   * The Phase 5 exit criterion.
   *
   * A thousand entries with random amounts and random dates, summed by PostgreSQL through the
   * summary endpoint, compared against a sum computed here in integer centimes. Integers are used
   * deliberately: an independent check written with the same decimal library would agree with the
   * implementation for the same wrong reason.
   */
  it('agrees to the centime over a thousand random entries', async () => {
    const coop = await createCooperative('Property Test Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const category = {
      INCOME: await makeCategory(coop.id, 'INCOME', 'Sale of produce'),
      EXPENSE: await makeCategory(coop.id, 'EXPENSE', 'Transport'),
    }

    let expectedCents = 0n
    let incomeCents = 0n
    let expenseCents = 0n
    const rows: {
      cooperativeId: string
      reference: string
      kind: 'INCOME' | 'EXPENSE'
      categoryId: string
      amount: string
      occurredAt: Date
      method: 'CASH'
      description: string
    }[] = []

    for (let index = 0; index < 1000; index += 1) {
      const kind = index % 3 === 0 ? 'EXPENSE' : 'INCOME'
      // Awkward amounts on purpose: a value whose centimes do not divide evenly is exactly where
      // a float would start to drift.
      const whole = Math.floor(Math.random() * 900_000) + 1
      const cents = Math.floor(Math.random() * 100)
      const amount = `${whole}.${String(cents).padStart(2, '0')}`
      const asCents = BigInt(whole) * 100n + BigInt(cents)

      if (kind === 'INCOME') {
        incomeCents += asCents
        expectedCents += asCents
      } else {
        expenseCents += asCents
        expectedCents -= asCents
      }

      const day = (index % 28) + 1
      const month = (index % 12) + 1
      rows.push({
        cooperativeId: coop.id,
        reference: `${kind === 'INCOME' ? 'IN' : 'EX'}-2026-${String(index + 1).padStart(6, '0')}`,
        kind,
        categoryId: category[kind],
        amount,
        occurredAt: new Date(
          `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00.000Z`,
        ),
        method: 'CASH',
        description: `Property entry ${index}`,
      })
    }

    await prisma.financeTransaction.createMany({ data: rows })

    const response = await as(
      owner,
      'get',
      '/finance/summary?from=2026-01-01&to=2026-12-31&groupBy=month',
      coop,
    ).expect(200)
    const data = response.body.data as {
      income: string
      expenses: string
      net: string
      buckets: { income: string; expenses: string }[]
    }

    expect(data.income).toBe(centsToWire(incomeCents))
    expect(data.expenses).toBe(centsToWire(expenseCents))
    expect(data.net).toBe(centsToWire(expectedCents))

    // And the twelve monthly buckets have to add back up to the same figures, so a reader who
    // sums the chart gets the headline number.
    const bucketIncome = data.buckets.reduce((total, row) => total + wireToCents(row.income), 0n)
    const bucketExpenses = data.buckets.reduce(
      (total, row) => total + wireToCents(row.expenses),
      0n,
    )
    expect(bucketIncome).toBe(incomeCents)
    expect(bucketExpenses).toBe(expenseCents)

    const ledger = await as(owner, 'get', '/finance/transactions?pageSize=1', coop).expect(200)
    expect(ledger.body.meta.totals.balance).toBe(centsToWire(expectedCents))
  }, 120_000)
})

/** Formats integer centimes the way the API formats money, without using the money module. */
function centsToWire(cents: bigint): string {
  const negative = cents < 0n
  const absolute = negative ? -cents : cents
  const whole = absolute / 100n
  const remainder = absolute % 100n
  return `${negative ? '-' : ''}${whole}.${String(remainder).padStart(2, '0')}`
}

function wireToCents(value: string): bigint {
  const negative = value.startsWith('-')
  const [whole = '0', fraction = '0'] = (negative ? value.slice(1) : value).split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2))
  return negative ? -cents : cents
}

describe('categories', () => {
  it('lists the active ones by default and the rest on request', async () => {
    const created = await as(manager, 'post', '/finance/categories')
      .send({ kind: 'EXPENSE', name: 'Fuel', nameRw: 'Lisansi' })
      .expect(201)
    const id = created.body.data.id as string

    await as(manager, 'patch', `/finance/categories/${id}`).send({ isActive: false }).expect(200)

    const active = await as(manager, 'get', '/finance/categories').expect(200)
    const all = await as(manager, 'get', '/finance/categories?includeInactive=true').expect(200)

    expect((active.body.data as { id: string }[]).some((row) => row.id === id)).toBe(false)
    expect((all.body.data as { id: string }[]).some((row) => row.id === id)).toBe(true)
  })

  it('carries the Kinyarwanda name', async () => {
    const created = await as(manager, 'post', '/finance/categories')
      .send({ kind: 'INCOME', name: 'Sale of honey', nameRw: 'Kugurisha ubuki' })
      .expect(201)
    expect(created.body.data.nameRw).toBe('Kugurisha ubuki')
  })

  it('refuses a duplicate name within the same kind and allows it across kinds', async () => {
    await as(manager, 'post', '/finance/categories')
      .send({ kind: 'EXPENSE', name: 'Interest' })
      .expect(201)
    const duplicate = await as(manager, 'post', '/finance/categories')
      .send({ kind: 'EXPENSE', name: 'Interest' })
      .expect(409)
    expect(duplicate.body.error.messageKey).toBe('errors.finance.categoryNameTaken')

    // The same word can mean money coming in and money going out, and a cooperative records both.
    await as(manager, 'post', '/finance/categories')
      .send({ kind: 'INCOME', name: 'Interest' })
      .expect(201)
  })

  it('never lets a category change which side of the balance it is on', async () => {
    const created = await as(manager, 'post', '/finance/categories')
      .send({ kind: 'INCOME', name: 'Fixed kind' })
      .expect(201)
    // Flipping the kind would change the sign of every entry already posted against it and
    // silently rewrite past months.
    await as(manager, 'patch', `/finance/categories/${created.body.data.id as string}`)
      .send({ kind: 'EXPENSE' })
      .expect(422)
  })

  it('has no delete route, and deactivating keeps the entries readable', async () => {
    const created = await as(manager, 'post', '/finance/categories')
      .send({ kind: 'INCOME', name: 'Used then retired' })
      .expect(201)
    const id = created.body.data.id as string

    const entry = await post({
      categoryId: id,
      amount: '1000',
      description: 'Against a retired category',
    })
    await as(manager, 'patch', `/finance/categories/${id}`).send({ isActive: false }).expect(200)

    const response = await request(app)
      .delete(`${API_PREFIX}/finance/categories/${id}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set(HEADERS.cooperativeId, cooperative.id)
    expect(response.status).toBe(404)

    // The entry still names where the money went, which is the whole reason deletion is not an
    // option.
    const detail = await as(manager, 'get', `/finance/transactions/${entry.id}`).expect(200)
    expect(detail.body.data.categoryName).toBe('Used then retired')
  })

  it('refuses a new entry against a deactivated category', async () => {
    const created = await as(manager, 'post', '/finance/categories')
      .send({ kind: 'INCOME', name: 'Closed for new entries' })
      .expect(201)
    const id = created.body.data.id as string
    await as(manager, 'patch', `/finance/categories/${id}`).send({ isActive: false }).expect(200)

    await as(accountant, 'post', '/finance/transactions')
      .send({ kind: 'INCOME', categoryId: id, amount: '1000', method: 'CASH', description: 'x' })
      .expect(422)
  })

  it('reports how much has gone through each one', async () => {
    const created = await as(manager, 'post', '/finance/categories')
      .send({ kind: 'INCOME', name: 'Counted category' })
      .expect(201)
    const id = created.body.data.id as string
    await post({ categoryId: id, amount: '1500.50' })
    await post({ categoryId: id, amount: '2500.50' })

    const response = await as(manager, 'get', '/finance/categories').expect(200)
    const row = (response.body.data as { id: string; entryCount: number; total: string }[]).find(
      (candidate) => candidate.id === id,
    )
    expect(row?.entryCount).toBe(2)
    expect(row?.total).toBe('4001.00')
  })

  it('needs finance:categories:manage to change, which a viewer does not hold', async () => {
    await as(viewer, 'get', '/finance/categories').expect(200)
    await as(viewer, 'post', '/finance/categories').send({ kind: 'INCOME', name: 'No' }).expect(403)
  })

  it('records the change in the audit trail', async () => {
    const created = await as(manager, 'post', '/finance/categories')
      .send({ kind: 'EXPENSE', name: 'Audited category' })
      .expect(201)
    const log = await prisma.auditLog.findFirst({
      where: { entityId: created.body.data.id as string, action: 'finance.category.created' },
    })
    expect(log).not.toBeNull()
  })
})

describe('the export', () => {
  it('sends a CSV with a dated filename and a byte order mark', async () => {
    const response = await as(manager, 'get', '/finance/export').expect(200)
    expect(response.headers['content-type']).toContain('text/csv')
    expect(response.headers['content-disposition']).toMatch(
      /attachment; filename="finance-.*\.csv"/,
    )
    // Excel on Windows needs the mark to read the Kinyarwanda characters as UTF-8.
    expect(response.text.charCodeAt(0)).toBe(0xfeff)
  })

  it('quotes every value and guards anything a spreadsheet would treat as a formula', async () => {
    await post({ amount: '1000', description: '=SUM(A1:A9), and a comma' })
    const response = await as(manager, 'get', '/finance/export?q=SUM').expect(200)
    expect(response.text).toContain(`"'=SUM(A1:A9), and a comma"`)
  })

  it('names the range it covers in the filename', async () => {
    const response = await as(
      manager,
      'get',
      '/finance/export?from=2026-01-01&to=2026-03-31',
    ).expect(200)
    // A cooperative keeps these files and has to know months later which period each one covers.
    expect(response.headers['content-disposition']).toContain('2026-01-01-to-2026-03-31')
  })

  it('sends a real spreadsheet when asked for one', async () => {
    const response = await as(manager, 'get', '/finance/export?format=xlsx')
      .buffer()
      .parse((res, callback) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => callback(null, Buffer.concat(chunks)))
      })
      .expect(200)

    expect(response.headers['content-type']).toContain('spreadsheetml.sheet')
    expect(response.headers['content-disposition']).toMatch(/\.xlsx"$/)
    // An xlsx file is a zip archive, which begins with PK.
    const body = response.body as Buffer
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(body.length).toBeGreaterThan(1000)
  })

  it('applies the same filters as the ledger', async () => {
    const all = await as(manager, 'get', '/finance/export').expect(200)
    const filtered = await as(manager, 'get', '/finance/export?kind=EXPENSE').expect(200)
    expect(filtered.text.length).toBeLessThan(all.text.length)
  })

  it('records who took a copy of the books', async () => {
    await as(manager, 'get', '/finance/export').expect(200)
    const log = await prisma.auditLog.findFirst({
      where: { cooperativeId: cooperative.id, action: 'finance.exported' },
      orderBy: { createdAt: 'desc' },
    })
    expect(log).not.toBeNull()
    expect(log?.actorLabel).toContain(manager.email)
  })

  it('needs finance:export, which a viewer does not hold', async () => {
    await as(viewer, 'get', '/finance/export').expect(403)
    await as(accountant, 'get', '/finance/export').expect(200)
  })
})

describe('a new cooperative', () => {
  it('starts with categories chosen for what it does', async () => {
    const created = await prisma.$transaction(async (tx) => {
      const type = await tx.cooperativeType.findFirstOrThrow({
        where: { key: 'TRANSPORT' },
        select: { id: true },
      })
      const coop = await tx.cooperative.create({
        data: {
          code: `SEEDCHECK-${randomUUID().slice(0, 8)}`.toUpperCase(),
          name: 'Seeded Categories Cooperative',
          typeId: type.id,
          province: 'KIGALI',
          district: 'Nyarugenge',
          sector: 'Nyamirambo',
          cell: 'Cyivugiza',
          village: 'Gasharu',
        },
        select: { id: true },
      })
      const { seedFinanceCategories } = await import('../src/modules/finance/finance.categories.js')
      await seedFinanceCategories(tx, coop.id, 'TRANSPORT')
      return coop.id
    })

    const categories = await prisma.financeCategory.findMany({
      where: { cooperativeId: created },
      select: { kind: true, name: true, nameRw: true, isSystem: true },
    })

    const names = categories.map((row) => row.name)
    // A transport cooperative buys fuel. Offering it "Packaging" and no "Fuel" would tell a
    // manager this software was not built for them.
    expect(names).toContain('Fuel')
    expect(names).toContain('Vehicle maintenance')
    expect(names).toContain('Membership fees')
    // Every one carries its Kinyarwanda name, so a cooperative working in Kinyarwanda does not
    // have to translate its own books first.
    expect(categories.every((row) => row.nameRw !== null && row.nameRw.length > 0)).toBe(true)
    expect(categories.every((row) => row.isSystem)).toBe(true)

    await prisma.financeCategory.deleteMany({ where: { cooperativeId: created } })
    await prisma.cooperative.delete({ where: { id: created } })
  })
})
