import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HEADERS } from '@coopmanage/shared'
import { API_PREFIX } from '../src/app.js'
import { testApp } from './server.js'
import { disconnectPrisma, prisma } from '../src/lib/prisma.js'
import {
  cleanupFixtures,
  createCooperative,
  createStaffSession,
  type Session,
  type TestCooperative,
  type TestUser,
} from './fixtures.js'

const app = testApp()

let cooperative: TestCooperative
let manager: TestUser & Session & { staffId: string }
let accountant: TestUser & Session & { staffId: string }
let secretary: TestUser & Session & { staffId: string }
let viewer: TestUser & Session & { staffId: string }
let incomeCategoryId: string
let expenseCategoryId: string

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

async function seedCategories(cooperativeId: string): Promise<{ income: string; expense: string }> {
  const income = await prisma.financeCategory.create({
    data: { cooperativeId, kind: 'INCOME', name: 'Membership fees', isSystem: true },
    select: { id: true },
  })
  const expense = await prisma.financeCategory.create({
    data: { cooperativeId, kind: 'EXPENSE', name: 'Payments to members', isSystem: true },
    select: { id: true },
  })
  return { income: income.id, expense: expense.id }
}

/** Registers a member and returns its id. */
async function addMember(
  overrides: Record<string, unknown> = {},
  session: Session = manager,
): Promise<{ id: string; memberCode: string }> {
  const response = await as(session, 'post', '/members')
    .send({ firstName: 'Uwase', lastName: 'Mukamana', ...overrides })
    .expect(201)
  return {
    id: response.body.data.id as string,
    memberCode: response.body.data.memberCode as string,
  }
}

beforeAll(async () => {
  cooperative = await createCooperative('Register Test Cooperative')
  manager = await createStaffSession(app, cooperative, 'MANAGER')
  accountant = await createStaffSession(app, cooperative, 'ACCOUNTANT')
  secretary = await createStaffSession(app, cooperative, 'SECRETARY')
  viewer = await createStaffSession(app, cooperative, 'VIEWER')
  const categories = await seedCategories(cooperative.id)
  incomeCategoryId = categories.income
  expenseCategoryId = categories.expense
}, 60_000)

afterAll(async () => {
  await cleanupFixtures()
  await disconnectPrisma()
})

describe('registering a member', () => {
  /**
   * The hard product rule, and the Phase 4 exit criterion. Farmers and ordinary members have no
   * smartphones and often no phone at all, and may not have their identity card with them when a
   * secretary registers them at a meeting.
   */
  it('accepts a name and nothing else', async () => {
    const response = await as(manager, 'post', '/members')
      .send({ firstName: 'Jean Claude', lastName: 'Nsanzimana' })
      .expect(201)

    const member = response.body.data
    expect(member.memberCode).toMatch(/^[A-Z0-9-]+-\d{5}$/)
    expect(member.phone).toBeNull()
    expect(member.nationalId).toBeNull()
    expect(member.email).toBeNull()
    expect(member.status).toBe('ACTIVE')
    expect(member.position).toBe('MEMBER')
    // The joining date is today, because that is when somebody registered at the desk joined.
    expect(member.joinedOn).toBe(new Date().toISOString().slice(0, 10))
  })

  it('never requires a phone number, at any point', async () => {
    // Explicitly empty, explicitly null, and absent: all three mean "not given".
    for (const phone of ['', null, undefined]) {
      const response = await as(manager, 'post', '/members')
        .send({
          firstName: 'Aline',
          lastName: 'Ingabire',
          ...(phone === undefined ? {} : { phone }),
        })
        .expect(201)
      expect(response.body.data.phone).toBeNull()
    }
  })

  it('refuses a member with no name', async () => {
    await as(manager, 'post', '/members').send({ lastName: 'Mukamana' }).expect(422)
    await as(manager, 'post', '/members')
      .send({ firstName: '   ', lastName: 'Mukamana' })
      .expect(422)
  })

  it('allocates codes in sequence without collision', async () => {
    const codes = await Promise.all([
      addMember({ firstName: 'A', lastName: 'One' }),
      addMember({ firstName: 'B', lastName: 'Two' }),
      addMember({ firstName: 'C', lastName: 'Three' }),
      addMember({ firstName: 'D', lastName: 'Four' }),
      addMember({ firstName: 'E', lastName: 'Five' }),
    ])
    const unique = new Set(codes.map((row) => row.memberCode))
    // Registered at the same moment. The allocation is an atomic increment inside the insert
    // transaction precisely so this cannot produce a duplicate.
    expect(unique.size).toBe(5)
  })

  it('normalises a phone number however it was written', async () => {
    const response = await as(manager, 'post', '/members')
      .send({ firstName: 'Eric', lastName: 'Habimana', phone: '+250 788 123 456' })
      .expect(201)
    expect(response.body.data.phone).toBe('+250788123456')
  })

  it('refuses a phone number that is not Rwandan rather than silently clearing it', async () => {
    await as(manager, 'post', '/members')
      .send({ firstName: 'Bad', lastName: 'Phone', phone: '12345' })
      .expect(422)
  })

  it('accepts a national identity number of sixteen digits, with or without spaces', async () => {
    const response = await as(manager, 'post', '/members')
      .send({ firstName: 'Solange', lastName: 'Mutesi', nationalId: '1199 8807 0123 4567' })
      .expect(201)
    expect(response.body.data.nationalId).toBe('1199880701234567')
  })

  it('refuses a national identity number that is the wrong length', async () => {
    await as(manager, 'post', '/members')
      .send({ firstName: 'Short', lastName: 'Id', nationalId: '123456' })
      .expect(422)
  })

  it('refuses a national identity number already held by another member', async () => {
    const nationalId = '1199880799999999'
    await as(manager, 'post', '/members')
      .send({ firstName: 'First', lastName: 'Holder', nationalId })
      .expect(201)

    const response = await as(manager, 'post', '/members')
      .send({ firstName: 'Second', lastName: 'Holder', nationalId })
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.member.nationalIdTaken')
  })

  it('lets two members in different cooperatives hold the same identity number', async () => {
    // The constraint is per cooperative, because the same person can belong to two cooperatives.
    const other = await createCooperative('Other Register Cooperative')
    const otherManager = await createStaffSession(app, other, 'MANAGER')
    const nationalId = '1199880788888888'

    await as(manager, 'post', '/members')
      .send({ firstName: 'Shared', lastName: 'Person', nationalId })
      .expect(201)
    await as(otherManager, 'post', '/members', other)
      .send({ firstName: 'Shared', lastName: 'Person', nationalId })
      .expect(201)
  })

  it('refuses an unknown field rather than ignoring it', async () => {
    await as(manager, 'post', '/members')
      .send({ firstName: 'A', lastName: 'B', shoeSize: 42 })
      .expect(422)
  })

  it('lets a secretary register a member but not an accountant', async () => {
    await as(secretary, 'post', '/members')
      .send({ firstName: 'By', lastName: 'Secretary' })
      .expect(201)
    await as(accountant, 'post', '/members')
      .send({ firstName: 'By', lastName: 'Accountant' })
      .expect(403)
  })

  it('records the registration in the audit trail', async () => {
    const member = await addMember({ firstName: 'Audited', lastName: 'Member' })
    const entry = await prisma.auditLog.findFirst({
      where: { entityId: member.id, action: 'member.created' },
    })
    expect(entry).not.toBeNull()
    expect(entry?.actorLabel).toContain(manager.email)
  })
})

describe('the register', () => {
  it('lists members with the masked identity number, never the whole one', async () => {
    await as(manager, 'post', '/members')
      .send({ firstName: 'Masked', lastName: 'Person', nationalId: '1199880711112222' })
      .expect(201)

    const response = await as(manager, 'get', '/members?q=Masked').expect(200)
    const row = response.body.data[0]
    expect(row.nationalIdMasked).toBe(`${'\u2022'.repeat(12)}2222`)
    // A roster on a shared office screen has no business showing the whole number.
    expect(JSON.stringify(response.body)).not.toContain('1199880711112222')
  })

  it('shows the whole identity number on the member detail view', async () => {
    const response = await as(manager, 'get', '/members?q=Masked').expect(200)
    const detail = await as(
      manager,
      'get',
      `/members/${response.body.data[0].id as string}`,
    ).expect(200)
    expect(detail.body.data.nationalId).toBe('1199880711112222')
  })

  it('searches by name, member code and phone number', async () => {
    const member = await addMember({
      firstName: 'Findable',
      lastName: 'Byname',
      phone: '0788999111',
    })

    for (const query of ['Findable', 'Byname', member.memberCode, '999111']) {
      const response = await as(manager, 'get', `/members?q=${encodeURIComponent(query)}`).expect(
        200,
      )
      const ids = response.body.data.map((row: { id: string }) => row.id)
      expect(ids, `searching for ${query}`).toContain(member.id)
    }
  })

  it('filters on whether a member has a phone number at all', async () => {
    await addMember({ firstName: 'Has', lastName: 'Aphone', phone: '0788222333' })
    await addMember({ firstName: 'Has', lastName: 'Nophone' })

    const withPhone = await as(manager, 'get', '/members?hasPhone=true').expect(200)
    const withoutPhone = await as(manager, 'get', '/members?hasPhone=false').expect(200)

    expect(withPhone.body.data.every((row: { phone: string | null }) => row.phone !== null)).toBe(
      true,
    )
    expect(
      withoutPhone.body.data.every((row: { phone: string | null }) => row.phone === null),
    ).toBe(true)
    // Members with no phone are the norm, so filtering for them has to work.
    expect(withoutPhone.body.meta.total).toBeGreaterThan(0)
  })

  it('paginates with a truthful total', async () => {
    const first = await as(manager, 'get', '/members?page=1&pageSize=3').expect(200)
    expect(first.body.data).toHaveLength(3)
    expect(first.body.meta.total).toBeGreaterThan(3)
    expect(first.body.meta.totalPages).toBe(Math.ceil(first.body.meta.total / 3))

    const second = await as(manager, 'get', '/members?page=2&pageSize=3').expect(200)
    const firstIds = first.body.data.map((row: { id: string }) => row.id)
    const secondIds = second.body.data.map((row: { id: string }) => row.id)
    expect(firstIds.some((id: string) => secondIds.includes(id))).toBe(false)
  })

  it('sorts only by the fields it allows', async () => {
    await as(manager, 'get', '/members?sort=-joinedOn').expect(200)
    await as(manager, 'get', '/members?sort=memberCode').expect(200)
    // An arbitrary sort field would be a way to probe the schema.
    await as(manager, 'get', '/members?sort=nationalId').expect(422)
  })

  it('refuses a date range that ends before it starts', async () => {
    await as(manager, 'get', '/members?joinedFrom=2026-06-01&joinedTo=2026-01-01').expect(422)
  })

  it('refuses an unknown filter rather than ignoring it', async () => {
    // A typo in a filter must never silently widen the result set.
    await as(manager, 'get', '/members?statuss=ACTIVE').expect(422)
    await as(manager, 'get', '/members?status=RETIRED').expect(422)
  })

  it('reports the figures the screen shows above the table', async () => {
    const response = await as(manager, 'get', '/members/stats').expect(200)
    expect(response.body.data.total).toBeGreaterThan(0)
    expect(response.body.data.byStatus.ACTIVE).toBeGreaterThan(0)
    // How many members cannot be reached by SMS, which is a fact a cooperative needs.
    expect(typeof response.body.data.withoutPhone).toBe('number')
  })

  it('lets a viewer read the register but not change it', async () => {
    await as(viewer, 'get', '/members').expect(200)
    await as(viewer, 'post', '/members').send({ firstName: 'No', lastName: 'Chance' }).expect(403)
  })
})

describe('editing and status', () => {
  it('updates only the fields it is given', async () => {
    const member = await addMember({ firstName: 'Before', lastName: 'Edit', district: 'Huye' })
    const response = await as(manager, 'patch', `/members/${member.id}`)
      .send({ district: 'Musanze' })
      .expect(200)

    expect(response.body.data.district).toBe('Musanze')
    expect(response.body.data.firstName).toBe('Before')
  })

  it('clears an optional field when given an empty string', async () => {
    const member = await addMember({ firstName: 'Clear', lastName: 'Phone', phone: '0788444555' })
    const response = await as(manager, 'patch', `/members/${member.id}`)
      .send({ phone: '' })
      .expect(200)
    expect(response.body.data.phone).toBeNull()
  })

  it('refuses an empty patch', async () => {
    const member = await addMember({ firstName: 'Empty', lastName: 'Patch' })
    await as(manager, 'patch', `/members/${member.id}`).send({}).expect(422)
  })

  it('has no delete endpoint at all', async () => {
    const member = await addMember({ firstName: 'Never', lastName: 'Deleted' })
    const response = await request(app)
      .delete(`${API_PREFIX}/members/${member.id}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set(HEADERS.cooperativeId, cooperative.id)
    // A member who left takes their contribution history with them if deleted, so the route
    // does not exist.
    expect(response.status).toBe(404)

    const still = await prisma.member.findUnique({ where: { id: member.id } })
    expect(still).not.toBeNull()
  })

  it('deactivates a member without removing them', async () => {
    const member = await addMember({ firstName: 'To', lastName: 'Deactivate' })
    const response = await as(manager, 'post', `/members/${member.id}/status`)
      .send({ status: 'INACTIVE', reason: 'Not farming this season' })
      .expect(200)

    expect(response.body.data.status).toBe('INACTIVE')
    const still = await prisma.member.findUnique({ where: { id: member.id } })
    expect(still).not.toBeNull()
  })

  it('records the exit date when a member leaves', async () => {
    const member = await addMember({ firstName: 'Has', lastName: 'Left' })
    const response = await as(manager, 'post', `/members/${member.id}/status`)
      .send({ status: 'EXITED', exitedOn: '2026-06-30', reason: 'Moved away' })
      .expect(200)

    expect(response.body.data.status).toBe('EXITED')
    expect(response.body.data.exitedOn).toBe('2026-06-30')
    expect(response.body.data.exitReason).toBe('Moved away')
  })

  it('requires an exit date when a member is marked as having left', async () => {
    const member = await addMember({ firstName: 'No', lastName: 'Exitdate' })
    // Without a date the register would say they left but not when, which is exactly what a
    // dispute about an old contribution turns on. An explicit null is the same omission written
    // differently, and defaulting it to today would record the wrong date silently.
    await as(manager, 'post', `/members/${member.id}/status`).send({ status: 'EXITED' }).expect(422)
    await as(manager, 'post', `/members/${member.id}/status`)
      .send({ status: 'EXITED', exitedOn: null })
      .expect(422)
  })

  it('clears the exit date when a member is reinstated', async () => {
    const member = await addMember({ firstName: 'Comes', lastName: 'Back' })
    await as(manager, 'post', `/members/${member.id}/status`)
      .send({ status: 'EXITED', exitedOn: '2026-01-31' })
      .expect(200)
    const response = await as(manager, 'post', `/members/${member.id}/status`)
      .send({ status: 'ACTIVE' })
      .expect(200)

    expect(response.body.data.status).toBe('ACTIVE')
    expect(response.body.data.exitedOn).toBeNull()
  })

  it('records the status change with its before and after', async () => {
    const member = await addMember({ firstName: 'Audited', lastName: 'Status' })
    await as(manager, 'post', `/members/${member.id}/status`)
      .send({ status: 'SUSPENDED', reason: 'Under review' })
      .expect(200)

    const entry = await prisma.auditLog.findFirst({
      where: { entityId: member.id, action: 'member.status.changed' },
      orderBy: { createdAt: 'desc' },
    })
    expect(entry?.before).toMatchObject({ status: 'ACTIVE' })
    expect(entry?.after).toMatchObject({ status: 'SUSPENDED' })
  })
})

describe('contributions', () => {
  it('posts the contribution and its income row in one transaction', async () => {
    const member = await addMember({ firstName: 'Pays', lastName: 'Afee' })
    const response = await as(accountant, 'post', `/members/${member.id}/contributions`)
      .send({
        type: 'MEMBERSHIP_FEE',
        amount: '5000',
        method: 'CASH',
        categoryId: incomeCategoryId,
      })
      .expect(201)

    expect(response.body.data.amount).toBe('5000.00')
    expect(response.body.data.reference).toMatch(/^IN-\d{4}-\d{6}$/)

    const contribution = await prisma.contribution.findUniqueOrThrow({
      where: { id: response.body.data.id as string },
      select: { financeTransactionId: true, amount: true },
    })
    // The contribution is the member-facing view of the same money as the ledger row. One
    // without the other would leave the books short with nothing to show why.
    expect(contribution.financeTransactionId).not.toBeNull()
    expect(contribution.amount.toString()).toBe('5000')
  })

  it('records one contribution for a repeated retry key', async () => {
    // The half of Phase 13's exit criterion that could cost a cooperative money. A treasurer on a
    // district-office connection presses Record, the page hangs, they press it again — and the
    // books must not end up holding the same 5,000 francs twice.
    const member = await addMember({ firstName: 'Pressed', lastName: 'Twice' })
    const key = randomUUID()
    const body = {
      type: 'MEMBERSHIP_FEE' as const,
      amount: '5000',
      method: 'CASH' as const,
      categoryId: incomeCategoryId,
      note: `Idempotent contribution ${key}`,
    }

    const first = await as(accountant, 'post', `/members/${member.id}/contributions`)
      .set(HEADERS.idempotencyKey, key)
      .send(body)
      .expect(201)
    const second = await as(accountant, 'post', `/members/${member.id}/contributions`)
      .set(HEADERS.idempotencyKey, key)
      .send(body)
      .expect(201)

    // The same receipt back, not a second one.
    expect(second.body.data.id).toBe(first.body.data.id)
    expect(second.body.data.reference).toBe(first.body.data.reference)

    const contributions = await prisma.contribution.count({ where: { memberId: member.id } })
    expect(contributions).toBe(1)

    // And one income row in the books, which is the figure a cooperative would have had to
    // reconcile by hand.
    const entries = await prisma.financeTransaction.count({
      where: { cooperativeId: cooperative.id, memberId: member.id },
    })
    expect(entries).toBe(1)
  })

  it('cancels a contribution once for a repeated retry key', async () => {
    const member = await addMember({ firstName: 'Cancelled', lastName: 'Once' })
    const recorded = await as(accountant, 'post', `/members/${member.id}/contributions`)
      .send({ type: 'SAVINGS', amount: '3000', method: 'CASH', categoryId: incomeCategoryId })
      .expect(201)

    const key = randomUUID()
    const id = recorded.body.data.id as string
    await as(accountant, 'post', `/contributions/${id}/void`)
      .set(HEADERS.idempotencyKey, key)
      .send({ reason: 'Recorded against the wrong member' })
      .expect(200)
    await as(accountant, 'post', `/contributions/${id}/void`)
      .set(HEADERS.idempotencyKey, key)
      .send({ reason: 'Recorded against the wrong member' })
      .expect(200)

    // Two reversals of one contribution would take the cooperative's total below where it started,
    // which is the same defect as a duplicate entry with the sign flipped.
    const reversals = await prisma.financeTransaction.count({
      where: { cooperativeId: cooperative.id, memberId: member.id, kind: 'EXPENSE' },
    })
    expect(reversals).toBe(1)
  })

  it('carries the amount as a string, never as a JSON number', async () => {
    const member = await addMember({ firstName: 'Exact', lastName: 'Amount' })
    const response = await as(accountant, 'post', `/members/${member.id}/contributions`)
      .send({ type: 'SAVINGS', amount: '12345.67', method: 'BANK', categoryId: incomeCategoryId })
      .expect(201)

    expect(response.body.data.amount).toBe('12345.67')
    expect(typeof response.body.data.amount).toBe('string')
  })

  it('rejects an amount with more decimal places than the column holds', async () => {
    const member = await addMember({ firstName: 'Too', lastName: 'Precise' })
    // Rounding it would mean the figure stored is not the figure typed.
    await as(accountant, 'post', `/members/${member.id}/contributions`)
      .send({ type: 'SAVINGS', amount: '1000.005', method: 'CASH', categoryId: incomeCategoryId })
      .expect(422)
  })

  it('rejects a zero or negative amount', async () => {
    const member = await addMember({ firstName: 'Zero', lastName: 'Amount' })
    for (const amount of ['0', '-500']) {
      await as(accountant, 'post', `/members/${member.id}/contributions`)
        .send({ type: 'SAVINGS', amount, method: 'CASH', categoryId: incomeCategoryId })
        .expect(422)
    }
  })

  it('refuses an expense category for income', async () => {
    const member = await addMember({ firstName: 'Wrong', lastName: 'Category' })
    // A contribution is income. Posting it against an expense category would put the money on
    // the wrong side of the balance.
    await as(accountant, 'post', `/members/${member.id}/contributions`)
      .send({ type: 'SAVINGS', amount: '1000', method: 'CASH', categoryId: expenseCategoryId })
      .expect(422)
  })

  it('leaves nothing behind when the posting fails', async () => {
    const member = await addMember({ firstName: 'Rolled', lastName: 'Back' })
    const before = await prisma.financeTransaction.count({
      where: { cooperativeId: cooperative.id },
    })

    await as(accountant, 'post', `/members/${member.id}/contributions`)
      .send({
        type: 'SAVINGS',
        amount: '1000',
        method: 'CASH',
        categoryId: '00000000-0000-4000-8000-000000000000',
      })
      .expect(422)

    const after = await prisma.financeTransaction.count({
      where: { cooperativeId: cooperative.id },
    })
    expect(after).toBe(before)
    const contributions = await prisma.contribution.count({ where: { memberId: member.id } })
    expect(contributions).toBe(0)
  })

  it('shows the contribution on the member summary', async () => {
    const member = await addMember({ firstName: 'Summary', lastName: 'Member' })
    await as(accountant, 'post', `/members/${member.id}/contributions`)
      .send({
        type: 'MEMBERSHIP_FEE',
        amount: '5000',
        method: 'CASH',
        categoryId: incomeCategoryId,
      })
      .expect(201)
    await as(accountant, 'post', `/members/${member.id}/contributions`)
      .send({ type: 'SAVINGS', amount: '20000', method: 'CASH', categoryId: incomeCategoryId })
      .expect(201)

    const response = await as(manager, 'get', `/members/${member.id}/summary`).expect(200)
    expect(response.body.data.contributions.count).toBe(2)
    expect(response.body.data.contributions.total).toBe('25000.00')
  })

  it('voids a contribution by reversing its income, never by deleting it', async () => {
    const member = await addMember({ firstName: 'Void', lastName: 'Contribution' })
    const created = await as(accountant, 'post', `/members/${member.id}/contributions`)
      .send({ type: 'SAVINGS', amount: '8000', method: 'CASH', categoryId: incomeCategoryId })
      .expect(201)

    const response = await as(
      accountant,
      'post',
      `/contributions/${created.body.data.id as string}/void`,
    )
      .send({ reason: 'Recorded twice by mistake' })
      .expect(200)

    expect(response.body.data.status).toBe('VOID')
    expect(response.body.data.reversalReference).toMatch(/^EX-\d{4}-\d{6}$/)

    // Both rows stay in the history: the mistake and its correction.
    const still = await prisma.contribution.findUniqueOrThrow({
      where: { id: created.body.data.id as string },
      select: { status: true, voidReason: true },
    })
    expect(still.status).toBe('VOID')
    expect(still.voidReason).toBe('Recorded twice by mistake')

    const summary = await as(manager, 'get', `/members/${member.id}/summary`).expect(200)
    // A voided contribution is no longer money the cooperative has.
    expect(summary.body.data.contributions.count).toBe(0)
  })

  it('refuses to void the same contribution twice', async () => {
    const member = await addMember({ firstName: 'Double', lastName: 'Void' })
    const created = await as(accountant, 'post', `/members/${member.id}/contributions`)
      .send({ type: 'SAVINGS', amount: '3000', method: 'CASH', categoryId: incomeCategoryId })
      .expect(201)

    await as(accountant, 'post', `/contributions/${created.body.data.id as string}/void`)
      .send({})
      .expect(200)
    await as(accountant, 'post', `/contributions/${created.body.data.id as string}/void`)
      .send({})
      .expect(409)
  })

  it('lets a secretary see contributions but not record them', async () => {
    await as(secretary, 'get', '/contributions').expect(200)
    const member = await addMember({ firstName: 'Secretary', lastName: 'Cannot' })
    await as(secretary, 'post', `/members/${member.id}/contributions`)
      .send({ type: 'SAVINGS', amount: '1000', method: 'CASH', categoryId: incomeCategoryId })
      .expect(403)
  })

  it('totals the filtered list across every page, not just the current one', async () => {
    const response = await as(accountant, 'get', '/contributions?pageSize=2').expect(200)
    expect(response.body.data.length).toBeLessThanOrEqual(2)
    expect(response.body.meta.totalAmount).toMatch(/^\d+\.\d{2}$/)
  })
})

describe('shares', () => {
  it('records a purchase and the income it brought in', async () => {
    const member = await addMember({ firstName: 'Buys', lastName: 'Shares' })
    const response = await as(accountant, 'post', `/members/${member.id}/shares`)
      .send({
        type: 'PURCHASE',
        quantity: 5,
        unitValue: '10000',
        categoryId: incomeCategoryId,
        method: 'CASH',
      })
      .expect(201)

    expect(response.body.data.quantity).toBe(5)
    // Five at ten thousand, computed with decimal arithmetic rather than a float.
    expect(response.body.data.totalValue).toBe('50000.00')
    expect(response.body.data.reference).toMatch(/^IN-\d{4}-\d{6}$/)
  })

  it('requires a category for a purchase, because the money has to land somewhere', async () => {
    const member = await addMember({ firstName: 'No', lastName: 'Category' })
    await as(accountant, 'post', `/members/${member.id}/shares`)
      .send({ type: 'PURCHASE', quantity: 1, unitValue: '10000' })
      .expect(422)
  })

  it('computes the holding as inbound minus outbound over the ledger', async () => {
    const member = await addMember({ firstName: 'Holds', lastName: 'Shares' })
    await as(accountant, 'post', `/members/${member.id}/shares`)
      .send({ type: 'PURCHASE', quantity: 10, unitValue: '10000', categoryId: incomeCategoryId })
      .expect(201)
    await as(accountant, 'post', `/members/${member.id}/shares`)
      .send({ type: 'REDEMPTION', quantity: 3, unitValue: '10000' })
      .expect(201)

    const response = await as(accountant, 'get', `/members/${member.id}/shares`).expect(200)
    // There is no stored balance to drift: the holding is derived from the rows every time.
    expect(response.body.data.holding.quantity).toBe(7)
    expect(response.body.data.holding.value).toBe('70000.00')
  })

  it('requires the other member for a transfer', async () => {
    const member = await addMember({ firstName: 'Transfers', lastName: 'Out' })
    await as(accountant, 'post', `/members/${member.id}/shares`)
      .send({ type: 'TRANSFER_OUT', quantity: 1, unitValue: '10000' })
      .expect(422)
  })

  it('refuses a transfer to a member of another cooperative', async () => {
    const other = await createCooperative('Foreign Share Cooperative')
    const otherManager = await createStaffSession(app, other, 'MANAGER')
    const foreign = await as(otherManager, 'post', '/members', other)
      .send({ firstName: 'Foreign', lastName: 'Member' })
      .expect(201)

    const member = await addMember({ firstName: 'Local', lastName: 'Member' })
    await as(accountant, 'post', `/members/${member.id}/shares`)
      .send({
        type: 'TRANSFER_OUT',
        quantity: 1,
        unitValue: '10000',
        counterpartyMemberId: foreign.body.data.id,
      })
      .expect(422)
  })

  it('voids a purchase by reversing its income, never by deleting it', async () => {
    const member = await addMember({ firstName: 'Voids', lastName: 'Ashare' })
    const created = await as(accountant, 'post', `/members/${member.id}/shares`)
      .send({ type: 'PURCHASE', quantity: 4, unitValue: '10000', categoryId: incomeCategoryId })
      .expect(201)

    const shareId = created.body.data.id as string
    const response = await as(accountant, 'post', `/members/${member.id}/shares/${shareId}/void`)
      .send({ reason: 'Wrong member' })
      .expect(200)

    expect(response.body.data.status).toBe('VOID')
    expect(response.body.data.reversalReference).toMatch(/^EX-\d{4}-\d{6}$/)

    const still = await prisma.memberShare.findUniqueOrThrow({
      where: { id: shareId },
      select: { status: true, voidReason: true },
    })
    expect(still.status).toBe('VOID')
    expect(still.voidReason).toBe('Wrong member')

    // The holding is derived from the POSTED rows, so voiding the purchase takes it back out.
    const after = await as(accountant, 'get', `/members/${member.id}/shares`).expect(200)
    expect(after.body.data.holding.quantity).toBe(0)
    expect(after.body.data.holding.value).toBe('0.00')
  })

  it('refuses to void the same share movement twice', async () => {
    const member = await addMember({ firstName: 'Double', lastName: 'Voidshare' })
    const created = await as(accountant, 'post', `/members/${member.id}/shares`)
      .send({ type: 'PURCHASE', quantity: 1, unitValue: '10000', categoryId: incomeCategoryId })
      .expect(201)
    const shareId = created.body.data.id as string

    await as(accountant, 'post', `/members/${member.id}/shares/${shareId}/void`)
      .send({})
      .expect(200)
    await as(accountant, 'post', `/members/${member.id}/shares/${shareId}/void`)
      .send({})
      .expect(409)
  })

  it('refuses to void a share belonging to a different member', async () => {
    const owner = await addMember({ firstName: 'Real', lastName: 'Owner' })
    const other = await addMember({ firstName: 'Some', lastName: 'Bodyelse' })
    const created = await as(accountant, 'post', `/members/${owner.id}/shares`)
      .send({ type: 'PURCHASE', quantity: 1, unitValue: '10000', categoryId: incomeCategoryId })
      .expect(201)

    // Addressed through the wrong member, the share reads as not found rather than being voided
    // from somebody else's profile.
    await as(
      accountant,
      'post',
      `/members/${other.id}/shares/${created.body.data.id as string}/void`,
    )
      .send({})
      .expect(404)
  })

  it('lets a viewer see shares but not void one', async () => {
    const member = await addMember({ firstName: 'Viewer', lastName: 'Cannotvoid' })
    const created = await as(accountant, 'post', `/members/${member.id}/shares`)
      .send({ type: 'PURCHASE', quantity: 1, unitValue: '10000', categoryId: incomeCategoryId })
      .expect(201)

    await as(viewer, 'get', `/members/${member.id}/shares`).expect(200)
    await as(viewer, 'post', `/members/${member.id}/shares/${created.body.data.id as string}/void`)
      .send({})
      .expect(403)
  })

  it('refuses a quantity of zero', async () => {
    const member = await addMember({ firstName: 'Zero', lastName: 'Shares' })
    await as(accountant, 'post', `/members/${member.id}/shares`)
      .send({ type: 'PURCHASE', quantity: 0, unitValue: '10000', categoryId: incomeCategoryId })
      .expect(422)
  })
})

describe('the member profile', () => {
  it('names the blocks that are not available yet rather than showing a zero', async () => {
    const member = await addMember({ firstName: 'Profile', lastName: 'Member' })
    const response = await as(manager, 'get', `/members/${member.id}/summary`).expect(200)

    // Quantity supplied needs stock receipts (Phase 6) and documents need Phase 9. "None
    // recorded" and "we cannot tell you yet" are different answers, and a cooperative must not
    // be shown the wrong one.
    expect(response.body.data.unavailable).toContain('quantitySupplied')
    expect(response.body.data.unavailable).toContain('documents')
  })

  it('names the blocks the caller may not see, instead of omitting them silently', async () => {
    const member = await addMember({ firstName: 'Withheld', lastName: 'Blocks' })
    // A secretary holds contributions:view and shares:view but not finance:view.
    const response = await as(secretary, 'get', `/members/${member.id}/summary`).expect(200)

    expect(response.body.data.payments).toBeNull()
    expect(response.body.data.withheld).toContain('payments')
    expect(response.body.data.withheld).not.toContain('contributions')
  })

  it('builds the timeline from the ledgers, newest first', async () => {
    const member = await addMember({ firstName: 'Timeline', lastName: 'Member' })
    await as(accountant, 'post', `/members/${member.id}/contributions`)
      .send({
        type: 'MEMBERSHIP_FEE',
        amount: '5000',
        method: 'CASH',
        categoryId: incomeCategoryId,
      })
      .expect(201)

    const response = await as(manager, 'get', `/members/${member.id}/timeline`).expect(200)
    const kinds = response.body.data.map((entry: { kind: string }) => entry.kind)
    expect(kinds).toContain('REGISTERED')
    expect(kinds).toContain('CONTRIBUTION')

    const dates = response.body.data.map((entry: { at: string }) => entry.at)
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  it('shows money paid out to the member, to somebody who may see it', async () => {
    const member = await addMember({ firstName: 'Gets', lastName: 'Paid' })
    await as(manager, 'post', '/finance/transactions')
      .send({
        kind: 'EXPENSE',
        categoryId: expenseCategoryId,
        amount: '185000',
        method: 'MOBILE_MONEY',
        description: 'Payment for delivered maize',
        memberId: member.id,
      })
      .expect(201)

    const summary = await as(manager, 'get', `/members/${member.id}/summary`).expect(200)
    expect(summary.body.data.payments.total).toBe('185000.00')

    const timeline = await as(manager, 'get', `/members/${member.id}/timeline`).expect(200)
    const payment = (timeline.body.data as { kind: string; amount: string }[]).find(
      (entry) => entry.kind === 'PAYMENT',
    )
    // A member asking when they were paid has to be able to see it, not just a total.
    expect(payment?.amount).toBe('185000.00')
  })

  it('leaves the payments out for somebody whose role does not cover them', async () => {
    const member = await addMember({ firstName: 'Hidden', lastName: 'Payment' })
    await as(manager, 'post', '/finance/transactions')
      .send({
        kind: 'EXPENSE',
        categoryId: expenseCategoryId,
        amount: '50000',
        method: 'CASH',
        description: 'Payment for delivered maize',
        memberId: member.id,
      })
      .expect(201)

    // A secretary holds contributions:view and shares:view but not finance:view.
    const timeline = await as(secretary, 'get', `/members/${member.id}/timeline`).expect(200)
    const kinds = (timeline.body.data as { kind: string }[]).map((entry) => entry.kind)
    expect(kinds).not.toContain('PAYMENT')
  })

  it('sends a message key and its parameters, never a finished English sentence', async () => {
    const member = await addMember({ firstName: 'Translatable', lastName: 'Timeline' })
    await as(accountant, 'post', `/members/${member.id}/contributions`)
      .send({ type: 'SAVINGS', amount: '2000', method: 'CASH', categoryId: incomeCategoryId })
      .expect(201)

    const response = await as(viewer, 'get', `/members/${member.id}/timeline`).expect(200)
    // The timeline is read in Kinyarwanda as often as in English, so the backend never decides
    // the wording. It sends what happened and the interface says it in the reader's language.
    for (const entry of response.body.data) {
      expect(entry.messageKey).toMatch(/^timeline\./)
      expect(entry.messageParams).toBeTypeOf('object')
    }
  })
})

describe('the export', () => {
  it('sends a CSV file with a dated filename', async () => {
    const response = await as(manager, 'get', '/members/export').expect(200)
    expect(response.headers['content-type']).toContain('text/csv')
    expect(response.headers['content-disposition']).toMatch(
      /attachment; filename="members-.*\.csv"/,
    )
  })

  it('quotes every value, so a name containing a comma does not shift the columns', async () => {
    await as(manager, 'post', '/members')
      .send({ firstName: 'Jean, Claude', lastName: "O'Brien" })
      .expect(201)

    const response = await as(manager, 'get', '/members/export?q=Claude').expect(200)
    expect(response.text).toContain('"Jean, Claude"')
    expect(response.text).toContain('"O\'Brien"')
  })

  it('guards a value that a spreadsheet would read as a formula', async () => {
    await as(manager, 'post', '/members')
      .send({ firstName: '=SUM(A1:A9)', lastName: 'Injection' })
      .expect(201)

    const response = await as(manager, 'get', '/members/export?q=Injection').expect(200)
    // Prefixed with an apostrophe so Excel treats it as text rather than evaluating it.
    expect(response.text).toContain(`"'=SUM(A1:A9)"`)
  })

  it('applies the same filters as the list, so the file matches what was on screen', async () => {
    const all = await as(manager, 'get', '/members/export').expect(200)
    const filtered = await as(manager, 'get', '/members/export?status=EXITED').expect(200)
    expect(filtered.text.length).toBeLessThan(all.text.length)
  })

  it('starts with a byte order mark, so Excel reads Kinyarwanda characters correctly', async () => {
    const response = await as(manager, 'get', '/members/export').expect(200)
    expect(response.text.charCodeAt(0)).toBe(0xfeff)
  })

  it('needs members:export, which a viewer does not hold', async () => {
    await as(viewer, 'get', '/members/export').expect(403)
    await as(manager, 'get', '/members/export').expect(200)
  })

  it('records who exported the register and how many rows', async () => {
    await as(manager, 'get', '/members/export').expect(200)
    const entry = await prisma.auditLog.findFirst({
      where: { cooperativeId: cooperative.id, action: 'member.exported' },
      orderBy: { createdAt: 'desc' },
    })
    // Bulk extraction of personal data is exactly the thing an audit trail is for.
    expect(entry).not.toBeNull()
    expect(entry?.actorLabel).toContain(manager.email)
  })
})
