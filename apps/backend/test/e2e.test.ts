import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HEADERS } from '@coopmanage/shared'
import { API_PREFIX } from '../src/app.js'
import { disconnectPrisma, prisma } from '../src/lib/prisma.js'
import { generateOpaqueToken, hashToken } from '../src/lib/tokens.js'
import { createUser, login, testEmail, type Session } from './fixtures.js'
import { pdfText } from './pdfText.js'
import { testApp } from './server.js'

/**
 * The nine critical flows of docs/roadmap.md Phase 17, end to end and **in one story**: a new
 * cooperative is created by the platform, its manager signs in for the first time, registers a
 * member, records money in and money out, adds a product, receives a delivery, sells some of it
 * and prints the month's report — and every figure on that report is checked against what the
 * earlier steps did.
 *
 * The other suites test each module against itself. This one tests the joins: that the sale's
 * payment is in the ledger, that the ledger is in the report, that the delivery less the sale is
 * what the store says is on the shelf. It runs against the same HTTP surface a browser uses, with
 * nothing stubbed but the e-mail that carries the manager's first password link.
 *
 * Every row it creates is cleaned up by the global teardown: the accounts are `@example.test`,
 * and the purge follows them to the cooperative they manage.
 */
const app = testApp()

const MONTH = { from: '2026-09-01', to: '2026-09-30' }

/** The dates the story happens on, inside the month the report is asked for. */
const DAY = '2026-09-15'

let admin: Session
let manager: Session
let cooperativeId: string
const managerEmail = testEmail('e2e-manager')
const MANAGER_PASSWORD = 'first-day-at-the-cooperative'

function as(session: Session, method: 'get' | 'post' | 'patch', path: string) {
  return request(app)
    [method](`${API_PREFIX}${path}`)
    .set('Authorization', `Bearer ${session.accessToken}`)
    .set(HEADERS.cooperativeId, cooperativeId)
}

/** Collects a binary body, which superagent has no parser for. */
function binary(call: request.Test) {
  return call.buffer().parse((res, callback) => {
    const chunks: Buffer[] = []
    res.on('data', (chunk: Buffer) => chunks.push(chunk))
    res.on('end', () => callback(null, Buffer.concat(chunks)))
  })
}

interface Doc {
  title: string
  sections: {
    key: string
    figures?: { key: string; value: string }[]
    rows?: Record<string, unknown>[]
  }[]
}

function figureOf(doc: Doc, sectionKey: string, figureKey: string): string {
  const section = doc.sections.find((candidate) => candidate.key === sectionKey)
  const figure = section?.figures?.find((candidate) => candidate.key === figureKey)
  if (!figure) throw new Error(`no figure ${sectionKey}.${figureKey}`)
  return figure.value
}

// What the story records, kept so the last step can check the report against it.
let memberId: string
let incomeCategoryId: string
let expenseCategoryId: string
let saleIncomeCategoryId: string
let productId: string
let warehouseId: string
let saleId: string
let saleReference: string

beforeAll(async () => {
  const platformAdmin = await createUser({ isPlatformAdmin: true, fullName: 'Platform Nkusi' })
  admin = await login(app, platformAdmin)
}, 60_000)

afterAll(async () => {
  await disconnectPrisma()
})

describe('the nine critical flows, as one cooperative’s first month', () => {
  it('1. the platform creates the cooperative and its manager', async () => {
    const code = `E2E-${randomUUID().slice(0, 6)}`.toUpperCase()
    const response = await request(app)
      .post(`${API_PREFIX}/admin/cooperatives`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        name: 'Koperative y’Abahinzi ba Nyabihu',
        code,
        typeKey: 'AGRICULTURE',
        province: 'WESTERN',
        district: 'Nyabihu',
        sector: 'Mukamira',
        cell: 'Kanyove',
        village: 'Rugeshi',
        manager: { email: managerEmail, fullName: 'Mukamana Chantal' },
      })
      .expect(201)
    cooperativeId = response.body.data.cooperative.id as string
    expect(response.body.data.manager.accountCreated).toBe(true)
  })

  it('2. the manager sets a password from the link and signs in', async () => {
    // The link goes out by e-mail, which is the one thing this story does not have. The token it
    // carries is planted the way the mail would deliver it — the same way `auth.test.ts` does.
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: managerEmail },
      select: { id: true, mustChangePassword: true },
    })
    expect(user.mustChangePassword).toBe(true)
    const token = generateOpaqueToken()
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    })
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    })
    await request(app)
      .post(`${API_PREFIX}/auth/reset-password`)
      .send({ token, password: MANAGER_PASSWORD })
      .expect(204)

    const signedIn = await request(app)
      .post(`${API_PREFIX}/auth/login`)
      .send({ email: managerEmail, password: MANAGER_PASSWORD })
      .expect(200)
    manager = { accessToken: signedIn.body.data.accessToken as string } as Session

    const me = await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set(HEADERS.cooperativeId, cooperativeId)
      .expect(200)
    expect(me.body.data.roleKey).toBe('MANAGER')
    expect(me.body.data.user.mustChangePassword).toBe(false)
    expect(me.body.data.cooperative.id).toBe(cooperativeId)
  })

  it('3. the first member is registered, without a telephone number', async () => {
    const response = await as(manager, 'post', '/members')
      .send({ firstName: 'Uwimana', lastName: 'Claudine', joinedOn: DAY, gender: 'FEMALE' })
      .expect(201)
    memberId = response.body.data.id as string
    // The card reads as the cooperative's own, not as a generic "COOP".
    expect(response.body.data.memberCode).toMatch(/^E2E-[A-Z0-9]{6}-00001$/)
    expect(response.body.data.phone).toBeNull()

    const stats = await as(manager, 'get', '/members/stats').expect(200)
    expect(stats.body.data.total).toBe(1)
    expect(stats.body.data.withoutPhone).toBe(1)
  })

  it('4. money in: a membership fee', async () => {
    // The cooperative starts with the categories its kind needs, so the treasurer never has to
    // invent a filing system before the first fee can be recorded.
    const categories = await as(manager, 'get', '/finance/categories').expect(200)
    const rows = categories.body.data as { id: string; kind: string; name: string }[]
    incomeCategoryId = rows.find((row) => row.name === 'Membership fees')?.id as string
    expenseCategoryId = rows.find((row) => row.name === 'Transport')?.id as string
    saleIncomeCategoryId = rows.find((row) => row.name === 'Sale of produce')?.id as string
    expect(incomeCategoryId).toBeTruthy()
    expect(expenseCategoryId).toBeTruthy()
    expect(saleIncomeCategoryId).toBeTruthy()

    const response = await as(manager, 'post', `/members/${memberId}/contributions`)
      .send({
        type: 'MEMBERSHIP_FEE',
        amount: '5000',
        method: 'CASH',
        categoryId: incomeCategoryId,
        paidOn: DAY,
      })
      .expect(201)
    expect(response.body.data.amount).toBe('5000.00')
    expect(response.body.data.reference).toMatch(/^IN-2026-\d{6}$/)
  })

  it('5. money out: transport, with the receipt number in the description', async () => {
    const response = await as(manager, 'post', '/finance/transactions')
      .send({
        kind: 'EXPENSE',
        categoryId: expenseCategoryId,
        amount: '12000',
        method: 'CASH',
        occurredAt: DAY,
        description: 'Receipt 0417, lorry to Mukamira',
      })
      .expect(201)
    expect(response.body.data.reference).toMatch(/^EX-2026-\d{6}$/)

    // The books so far: 5,000 in, 12,000 out.
    const summary = await as(
      manager,
      'get',
      `/finance/summary?from=${MONTH.from}&to=${MONTH.to}`,
    ).expect(200)
    expect(summary.body.data.income).toBe('5000.00')
    expect(summary.body.data.expenses).toBe('12000.00')
    expect(summary.body.data.net).toBe('-7000.00')
  })

  it('6. a product is added to the catalogue', async () => {
    const units = await as(manager, 'get', '/units').expect(200)
    const kg = (units.body.data as { key: string; id: string }[]).find((row) => row.key === 'KG')
    const store = await as(manager, 'post', '/warehouses').send({ name: 'Main store' }).expect(201)
    warehouseId = store.body.data.id as string

    const response = await as(manager, 'post', '/products')
      .send({
        name: 'Irish potatoes',
        nameRw: 'Ibirayi',
        unitId: kg?.id,
        minStockLevel: '200',
        defaultSalePrice: '380',
      })
      .expect(201)
    productId = response.body.data.id as string
    expect(response.body.data.sku).toBe('IRISH-POTATOES')
    expect(response.body.data.quantityOnHand).toBe('0.000')
  })

  it('7. a delivery is received into the store', async () => {
    const response = await as(manager, 'post', '/inventory/receive')
      .send({ productId, warehouseId, quantity: '1500', note: 'From the Kanyove growers' })
      .expect(201)
    expect(response.body.data.quantity).toBe('1500.000')

    const stock = await as(manager, 'get', '/inventory/stock').expect(200)
    const row = (stock.body.data as { productId: string; quantity: string; isLow: boolean }[]).find(
      (candidate) => candidate.productId === productId,
    )
    expect(row?.quantity).toBe('1500.000')
    expect(row?.isLow).toBe(false)
  })

  it('8. a sale is written up, confirmed and paid, and the stock and the ledger both move', async () => {
    const buyer = await as(manager, 'post', '/buyers')
      .send({ name: 'Musanze market trader' })
      .expect(201)
    const draft = await as(manager, 'post', '/sales')
      .send({
        buyerId: buyer.body.data.id,
        warehouseId,
        saleDate: DAY,
        lines: [{ productId, quantity: '400', unitPrice: '380' }],
      })
      .expect(201)
    saleId = draft.body.data.id as string
    saleReference = draft.body.data.reference as string
    expect(draft.body.data.status).toBe('DRAFT')
    expect(draft.body.data.total).toBe('152000.00')

    // A draft has moved nothing.
    let stock = await as(manager, 'get', '/inventory/stock').expect(200)
    expect(
      (stock.body.data as { productId: string; quantity: string }[]).find(
        (row) => row.productId === productId,
      )?.quantity,
    ).toBe('1500.000')

    const confirmed = await as(manager, 'post', `/sales/${saleId}/confirm`)
      .send({
        amountPaid: '100000',
        method: 'MOBILE_MONEY',
        incomeCategoryId: saleIncomeCategoryId,
      })
      .expect(200)
    expect(confirmed.body.data.status).toBe('CONFIRMED')
    expect(confirmed.body.data.amountPaid).toBe('100000.00')
    expect(confirmed.body.data.outstanding).toBe('52000.00')

    // Now the shelf is 1,500 less 400, and the ledger has the 100,000 that was paid.
    stock = await as(manager, 'get', '/inventory/stock').expect(200)
    expect(
      (stock.body.data as { productId: string; quantity: string }[]).find(
        (row) => row.productId === productId,
      )?.quantity,
    ).toBe('1100.000')

    const summary = await as(
      manager,
      'get',
      `/finance/summary?from=${MONTH.from}&to=${MONTH.to}`,
    ).expect(200)
    expect(summary.body.data.income).toBe('105000.00')
    expect(summary.body.data.expenses).toBe('12000.00')
    expect(summary.body.data.closing).toBe('93000.00')

    // The rest is paid a week later, and the ledger follows.
    await as(manager, 'post', `/sales/${saleId}/payments`)
      .send({
        amount: '52000',
        method: 'CASH',
        incomeCategoryId: saleIncomeCategoryId,
        paidOn: '2026-09-22',
      })
      .expect(201)
    const settled = await as(manager, 'get', `/sales/${saleId}`).expect(200)
    expect(settled.body.data.outstanding).toBe('0.00')
    expect(settled.body.data.paymentStatus).toBe('PAID')
  })

  it('9. the month’s report says exactly what the month did', async () => {
    const preview = await as(manager, 'post', '/reports/monthly-cooperative/preview')
      .send(MONTH)
      .expect(200)
    const doc = preview.body.data as Doc
    expect(doc.sections.map((section) => section.key)).toEqual([
      'members',
      'finance',
      'categories',
      'inventory',
      'lowStock',
      'sales',
      'topProducts',
    ])

    // Members: one, registered this month, unreachable by SMS.
    expect(figureOf(doc, 'members', 'total')).toBe('1')
    expect(figureOf(doc, 'members', 'joined')).toBe('1')
    expect(figureOf(doc, 'members', 'withoutPhone')).toBe('1')

    // Money: 5,000 fee + 100,000 + 52,000 from the sale in; 12,000 out.
    expect(figureOf(doc, 'finance', 'opening')).toBe('0.00')
    expect(figureOf(doc, 'finance', 'income')).toBe('157000.00')
    expect(figureOf(doc, 'finance', 'expenses')).toBe('12000.00')
    expect(figureOf(doc, 'finance', 'net')).toBe('145000.00')
    expect(figureOf(doc, 'finance', 'closing')).toBe('145000.00')

    // Sales: one, worth 152,000, fully paid.
    expect(figureOf(doc, 'sales', 'count')).toBe('1')
    expect(figureOf(doc, 'sales', 'sold')).toBe('152000.00')
    expect(figureOf(doc, 'sales', 'paid')).toBe('152000.00')
    expect(figureOf(doc, 'sales', 'outstanding')).toBe('0.00')

    // Stock: one product, none below its minimum.
    expect(figureOf(doc, 'inventory', 'products')).toBe('1')
    expect(figureOf(doc, 'inventory', 'low')).toBe('0')

    // And on paper, in the cooperative's own language.
    const pdf = await binary(
      as(manager, 'post', '/reports/monthly-cooperative/export').send({
        ...MONTH,
        format: 'pdf',
        locale: 'RW',
      }),
    ).expect(200)
    expect(pdf.headers['content-type']).toBe('application/pdf')
    const text = pdfText(pdf.body as Buffer)
    expect(text).toContain('Nyabihu')
    expect(text).toContain('157,000')
    expect(text).toContain('152,000')

    const runs = await as(manager, 'get', '/reports/runs').expect(200)
    expect(
      (runs.body.data as { type: string }[]).some((row) => row.type === 'monthly-cooperative'),
    ).toBe(true)
  })

  it('leaves an audit trail a person could follow through the month', async () => {
    const audit = await as(manager, 'get', '/audit?limit=100').expect(200)
    const actions = (audit.body.data as { action: string }[]).map((row) => row.action)
    for (const expected of [
      'member.created',
      'member.contribution.recorded',
      'finance.transaction.posted',
      'catalogue.product.created',
      'inventory.received',
      'sales.sale.drafted',
      'sales.sale.confirmed',
      'sales.payment.recorded',
      'report.exported',
    ]) {
      expect(actions, expected).toContain(expected)
    }
    expect(saleReference).toMatch(/^SL-2026-/)
  })
})
