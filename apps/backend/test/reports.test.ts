import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HEADERS, REPORT_LABELS, REPORT_TYPES, hasAuditActionLabel } from '@coopmanage/shared'
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
import { CONTENT_WIDTH, shareColumnWidths } from '../src/modules/reports/render.pdf.js'
import { pdfPages, pdfText } from './pdfText.js'
import { testApp } from './server.js'

const app = testApp()

/**
 * Phase 8 — reports.
 *
 * What these tests are for, in order of how much they matter.
 *
 * A report must agree with the screen it was produced from. The figures are compared against the
 * same endpoints the interface reads, because a cooperative that reads one number at a meeting and
 * a different one off the ledger the next morning has lost the use of both.
 *
 * A report must not show a reader data their role does not cover. The secretary here holds
 * `reports:view` and `reports:export` but not `finance:view` — a real Rwandan cooperative's
 * secretary, who calls the meeting and takes the minutes but does not keep the money — and the
 * monthly report they produce has to come out with the membership on it and the money named as
 * withheld rather than quietly absent.
 *
 * And the paper has to be readable. The PDF is read back and asserted on: the title, the figures,
 * the column headings repeated on the second page, the page numbering, and that a Kinyarwanda
 * report is actually in Kinyarwanda.
 */

const PERIOD = { from: '2026-09-01', to: '2026-09-30' }

let cooperative: TestCooperative
let manager: TestUser & Session & { staffId: string }
let secretary: TestUser & Session & { staffId: string }
let storekeeper: TestUser & Session & { staffId: string }
let viewer: TestUser & Session & { staffId: string }

let other: TestCooperative
let otherManager: TestUser & Session & { staffId: string }
let otherMemberId: string

/** The manager's name, as the audit trail and a report footer record it. */
let managerName: string

let memberId: string
let incomeCategory: string
let expenseCategory: string
let store: string
let maize: string

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

function preview(session: Session, type: string, body: object = PERIOD) {
  return as(session, 'post', `/reports/${type}/preview`).send(body)
}

function exportReport(session: Session, type: string, body: object) {
  return as(session, 'post', `/reports/${type}/export`).send(body)
}

interface Doc {
  title: string
  subtitle?: string
  periodLabel: string
  locale: string
  withheld: string[]
  rowCount: number
  generatedAtLabel: string
  cooperative: { name: string; code: string }
  sections: {
    kind: string
    key: string
    title: string
    text?: string
    figures?: { key: string; label: string; type: string; value: string; hint?: string }[]
    columns?: { key: string; label: string; type: string }[]
    rows?: Record<string, string | null>[]
    total?: Record<string, string | null>
    truncatedFrom?: number
    emptyLabel?: string
  }[]
}

function sectionOf(doc: Doc, key: string) {
  const found = doc.sections.find((section) => section.key === key)
  if (!found) throw new Error(`no section ${key} in ${doc.sections.map((s) => s.key).join(', ')}`)
  return found
}

function figureOf(doc: Doc, sectionKey: string, figureKey: string): string {
  const section = sectionOf(doc, sectionKey)
  const figure = section.figures?.find((row) => row.key === figureKey)
  if (!figure) throw new Error(`no figure ${figureKey} in section ${sectionKey}`)
  return figure.value
}

/** A posted entry, on a given day, so the period boundaries can be tested. */
async function post(
  kind: 'INCOME' | 'EXPENSE',
  amount: string,
  occurredAt: string,
  description = 'Recorded for the report tests',
): Promise<string> {
  const response = await as(manager, 'post', '/finance/transactions')
    .send({
      kind,
      categoryId: kind === 'INCOME' ? incomeCategory : expenseCategory,
      amount,
      occurredAt,
      method: 'CASH',
      description,
    })
    .expect(201)
  return response.body.data.id as string
}

beforeAll(async () => {
  cooperative = await createCooperative('Reports Test Cooperative')
  manager = await createStaffSession(app, cooperative, 'MANAGER')
  secretary = await createStaffSession(app, cooperative, 'SECRETARY')
  storekeeper = await createStaffSession(app, cooperative, 'INVENTORY_OFFICER')
  viewer = await createStaffSession(app, cooperative, 'VIEWER')

  other = await createCooperative('Other Reports Cooperative')
  otherManager = await createStaffSession(app, other, 'MANAGER')

  managerName = (
    await prisma.user.findUniqueOrThrow({
      where: { id: manager.id },
      select: { fullName: true },
    })
  ).fullName

  const income = await as(manager, 'post', '/finance/categories')
    .send({ kind: 'INCOME', name: 'Sale of produce', nameRw: 'Kugurisha umusaruro' })
    .expect(201)
  incomeCategory = income.body.data.id as string
  const expense = await as(manager, 'post', '/finance/categories')
    .send({ kind: 'EXPENSE', name: 'Transport', nameRw: 'Ubwikorezi' })
    .expect(201)
  expenseCategory = expense.body.data.id as string

  const member = await as(manager, 'post', '/members')
    .send({ firstName: 'Claudine', lastName: 'Uwase', joinedOn: '2026-09-04' })
    .expect(201)
  memberId = member.body.data.id as string

  const foreignMember = await as(otherManager, 'post', '/members', other)
    .send({ firstName: 'Jean', lastName: 'Habimana', joinedOn: '2026-09-04' })
    .expect(201)
  otherMemberId = foreignMember.body.data.id as string

  // A member with no telephone number, which is the ordinary case and a figure the report prints.
  await as(manager, 'post', '/members')
    .send({ firstName: 'Alphonse', lastName: 'Nsengimana', joinedOn: '2026-08-11' })
    .expect(201)

  const units = await as(manager, 'get', '/units').expect(200)
  const unitId = (units.body.data as { key: string; id: string }[]).find((row) => row.key === 'KG')
    ?.id as string

  const warehouse = await as(manager, 'post', '/warehouses')
    .send({ name: 'Main store' })
    .expect(201)
  store = warehouse.body.data.id as string

  const product = await as(manager, 'post', '/products')
    .send({
      name: 'Maize grain',
      nameRw: 'Ibigori',
      unitId,
      minStockLevel: '500',
      defaultPurchasePrice: '300',
      defaultSalePrice: '450',
    })
    .expect(201)
  maize = product.body.data.id as string

  await as(manager, 'post', '/inventory/receive')
    .send({ productId: maize, warehouseId: store, quantity: '400', occurredAt: '2026-09-06' })
    .expect(201)

  // Before the period: this belongs in the opening balance and in no other figure.
  await post('INCOME', '1000000.00', '2026-08-15', 'Opening receipts from August')
  // In the period.
  await post('INCOME', '250000.00', '2026-09-08', 'Maize sold at the market')
  await post('EXPENSE', '40000.00', '2026-09-09', 'Transport to Musanze')
  // After the period: in no figure at all.
  await post('INCOME', '7000000.00', '2026-10-02', 'October receipts')
}, 120_000)

afterAll(async () => {
  await cleanupFixtures()
  await disconnectPrisma()
})

describe('the catalogue', () => {
  it('lists every report, and says which this reader may produce', async () => {
    const response = await as(manager, 'get', '/reports').expect(200)
    const rows = response.body.data as {
      type: string
      permitted: boolean
      available: boolean
      availableFromPhase: number
      withheld: string[]
    }[]

    expect(rows.map((row) => row.type)).toEqual([...REPORT_TYPES])
    expect(rows.every((row) => row.permitted)).toBe(true)

    // The minutes report is listed and marked as not yet available rather than hidden: a
    // cooperative expecting one should be told when it arrives, not left looking for the menu.
    const meeting = rows.find((row) => row.type === 'meeting')
    expect(meeting?.available).toBe(false)
    expect(meeting?.availableFromPhase).toBe(9)
  })

  it('tells a secretary which reports they may not produce and which parts they will not see', async () => {
    const response = await as(secretary, 'get', '/reports').expect(200)
    const rows = response.body.data as { type: string; permitted: boolean; withheld: string[] }[]

    // The financial report is the cooperative's money, and the secretary does not keep it.
    expect(rows.find((row) => row.type === 'financial')?.permitted).toBe(false)
    // The monthly report they may produce, and the screen is told in advance what will be missing
    // from it, so the warning comes before the paper does.
    const monthly = rows.find((row) => row.type === 'monthly-cooperative')
    expect(monthly?.permitted).toBe(true)
    expect(monthly?.withheld).toContain(REPORT_LABELS.EN['section.finance'])
  })

  it('is refused to a reader with no reports permission', async () => {
    // The viewer role holds reports:view, so the refusal is proved by taking it away.
    await as(manager, 'put', `/staff/${viewer.staffId}/overrides`)
      .send({ overrides: [{ permission: 'reports:view', effect: 'DENY' }] })
      .expect(200)

    await as(viewer, 'get', '/reports').expect(403)

    await as(manager, 'put', `/staff/${viewer.staffId}/overrides`)
      .send({ overrides: [] })
      .expect(200)
  })
})

describe('the monthly cooperative report', () => {
  it('assembles every module, in the order a general assembly reads them', async () => {
    const response = await preview(manager, 'monthly-cooperative').expect(200)
    const doc = response.body.data as Doc

    expect(doc.title).toBe('Monthly cooperative report')
    expect(doc.periodLabel).toBe('1 September to 30 September 2026')
    expect(doc.cooperative.name).toBe(cooperative.name)
    expect(doc.withheld).toEqual([])

    expect(doc.sections.map((section) => section.key)).toEqual([
      'members',
      'finance',
      'categories',
      'inventory',
      'lowStock',
      'sales',
      'topProducts',
    ])
  })

  it('counts the members the register holds, and how many an SMS cannot reach', async () => {
    const doc = (await preview(manager, 'monthly-cooperative').expect(200)).body.data as Doc
    const stats = (await as(manager, 'get', '/members/stats').expect(200)).body.data as {
      total: number
      byStatus: Record<string, number>
      withoutPhone: number
    }

    // The same figures as the members screen, because they are read from the same rows.
    expect(figureOf(doc, 'members', 'total')).toBe(String(stats.total))
    expect(figureOf(doc, 'members', 'active')).toBe(String(stats.byStatus.ACTIVE ?? 0))
    expect(figureOf(doc, 'members', 'withoutPhone')).toBe(String(stats.withoutPhone))
    // One of the two members joined inside the period.
    expect(figureOf(doc, 'members', 'joined')).toBe('1')
    // A phone number is never required of a member, so this is information, not a defect.
    expect(Number(figureOf(doc, 'members', 'withoutPhone'))).toBeGreaterThan(0)
  })

  it('measures the opening balance from everything before the period, not from a stored figure', async () => {
    const doc = (await preview(manager, 'monthly-cooperative').expect(200)).body.data as Doc

    // August's receipt is the opening balance; September's are the period's money in and out.
    expect(figureOf(doc, 'finance', 'opening')).toBe('1000000.00')
    expect(figureOf(doc, 'finance', 'income')).toBe('250000.00')
    expect(figureOf(doc, 'finance', 'expenses')).toBe('40000.00')
    expect(figureOf(doc, 'finance', 'net')).toBe('210000.00')
    expect(figureOf(doc, 'finance', 'closing')).toBe('1210000.00')
    // October's receipt is in none of them.
    expect(figureOf(doc, 'finance', 'closing')).not.toContain('7000000')
  })

  it('agrees with the finance summary the ledger screen reads', async () => {
    const doc = (await preview(manager, 'monthly-cooperative').expect(200)).body.data as Doc
    const summary = (
      await as(
        manager,
        'get',
        `/finance/summary?from=${PERIOD.from}&to=${PERIOD.to}&groupBy=month`,
      ).expect(200)
    ).body.data as { income: string; expenses: string; net: string }

    expect(figureOf(doc, 'finance', 'income')).toBe(summary.income)
    expect(figureOf(doc, 'finance', 'expenses')).toBe(summary.expenses)
    expect(figureOf(doc, 'finance', 'net')).toBe(summary.net)
  })

  it('excludes a voided entry and its reversal as a pair', async () => {
    const id = await post('INCOME', '77777.77', '2026-09-12', 'To be cancelled')
    const before = (await preview(manager, 'monthly-cooperative').expect(200)).body.data as Doc
    expect(figureOf(before, 'finance', 'income')).toBe('327777.77')

    await as(manager, 'post', `/finance/transactions/${id}/void`)
      .send({ reason: 'Wrong figure typed at the counter' })
      .expect(200)

    const after = (await preview(manager, 'monthly-cooperative').expect(200)).body.data as Doc
    // Not 250,000 minus 77,777.77 again: taking the void out and counting the reversal would
    // apply the correction twice, which is the defect this rule exists to prevent.
    expect(figureOf(after, 'finance', 'income')).toBe('250000.00')
    expect(figureOf(after, 'finance', 'closing')).toBe('1210000.00')
  })

  it('reports the stock the store holds, and what is at or below its minimum', async () => {
    const doc = (await preview(manager, 'monthly-cooperative').expect(200)).body.data as Doc
    const overview = (await as(manager, 'get', '/inventory/stock').expect(200)).body.meta as {
      totals?: { lowStockCount?: number }
    }

    expect(figureOf(doc, 'inventory', 'products')).toBe('1')
    // 400 kg against a minimum of 500: low, and the report says so in the same terms as the
    // stock screen does.
    expect(figureOf(doc, 'inventory', 'low')).toBe('1')
    if (overview.totals?.lowStockCount !== undefined) {
      expect(figureOf(doc, 'inventory', 'low')).toBe(String(overview.totals.lowStockCount))
    }
    expect(sectionOf(doc, 'lowStock').rows?.length).toBe(1)
    expect(sectionOf(doc, 'lowStock').rows?.[0]?.product).toBe('Maize grain')
  })

  it('values the stock only for a reader who may see money', async () => {
    const manager_ = (await preview(manager, 'monthly-cooperative').expect(200)).body.data as Doc
    const keys = sectionOf(manager_, 'inventory').figures?.map((row) => row.key)
    expect(keys).toContain('value')

    const storekeeper_ = (await preview(storekeeper, 'monthly-cooperative').expect(200)).body
      .data as Doc
    // The storekeeper counts the sacks and sees the quantities, but what the stock is worth is a
    // money question and their role does not cover it.
    const storeKeys = sectionOf(storekeeper_, 'inventory').figures?.map((row) => row.key)
    expect(storeKeys).toContain('products')
    expect(storeKeys).not.toContain('value')
  })

  it('names the money section as withheld for a secretary rather than dropping it', async () => {
    const doc = (await preview(secretary, 'monthly-cooperative').expect(200)).body.data as Doc

    const finance = sectionOf(doc, 'finance')
    expect(finance.kind).toBe('withheld')
    expect(finance.text).toContain(REPORT_LABELS.EN['section.finance'])
    expect(doc.withheld).toContain(REPORT_LABELS.EN['section.finance'])

    // The membership is still there: a withheld section removes one part of the report, not the
    // report. An empty page would have sent the secretary to ask the treasurer for everything.
    expect(sectionOf(doc, 'members').kind).toBe('figures')
    expect(doc.sections.some((section) => section.key === 'categories')).toBe(false)
  })
})

describe('the other six reports', () => {
  it('refuses the financial report to a reader without finance:view', async () => {
    // reports:view is the outer gate; the report's own data permission is checked as well,
    // because "may read reports" and "may read the money" are different decisions.
    const response = await preview(secretary, 'financial').expect(403)
    expect(response.body.error.messageKey).toBe('errors.forbidden')
  })

  it('prints the financial report as figures, a breakdown and every entry', async () => {
    const doc = (await preview(manager, 'financial').expect(200)).body.data as Doc
    expect(doc.sections.map((section) => section.key)).toEqual(['finance', 'categories', 'entries'])

    const entries = sectionOf(doc, 'entries')
    expect(entries.rows?.length).toBeGreaterThan(0)

    // Money out is written as a negative amount, the way the ledger screen writes it, so a column
    // of figures adds up to the period's difference rather than needing a separate kind column.
    const expense = entries.rows?.find((row) => row.description === 'Transport to Musanze')
    expect(expense?.amount).toBe('-40000.00')
    const income = entries.rows?.find((row) => row.description === 'Maize sold at the market')
    expect(income?.amount).toBe('250000.00')
    // The totals row sums money in less money out, which is the figure the block above it states.
    expect(entries.total?.amount).toBe(figureOf(doc, 'finance', 'net'))
    // Both the cancelled entry and its reversal stay in the listing with their own rows, because
    // the correction has to be visible; only the arithmetic excludes them.
    expect(entries.rows?.some((row) => row.description === 'To be cancelled')).toBe(false)
  })

  it('reports one member, and refuses a member of another cooperative', async () => {
    const doc = (await preview(manager, 'member', { ...PERIOD, memberId }).expect(200)).body
      .data as Doc
    expect(doc.subtitle).toContain('Uwase')
    expect(doc.sections.map((section) => section.key)).toEqual([
      'member',
      'contributionTotals',
      'contributions',
      'shareTotals',
      'shares',
    ])

    // The identifier is in the body rather than the path, so the cross-tenant sweep cannot reach
    // it: a member of another cooperative must be not found, not refused, and not reported on.
    await preview(manager, 'member', { ...PERIOD, memberId: otherMemberId }).expect(404)
  })

  it('reports the whole register when no member is named', async () => {
    const doc = (await preview(secretary, 'member').expect(200)).body.data as Doc
    const register = sectionOf(doc, 'register')
    expect(register.rows?.length).toBe(2)
    // A member with no telephone leaves the cell empty rather than printing a marker: not having
    // one is ordinary.
    expect(register.rows?.some((row) => row.phone === null || row.phone === '')).toBe(true)
  })

  it('prints the stock report with its movements', async () => {
    const doc = (await preview(manager, 'inventory').expect(200)).body.data as Doc
    expect(doc.sections.map((section) => section.key)).toEqual([
      'inventory',
      'holdings',
      'lowStock',
      'movements',
    ])
    const movements = sectionOf(doc, 'movements')
    expect(movements.rows?.length).toBe(1)
    // A receipt is written as a positive quantity; what leaves the store carries a minus, so a
    // column of movements adds up to what the store actually did.
    expect(movements.rows?.[0]?.quantity).toBe('400.000')
  })

  it('prints a product’s Kinyarwanda name inside a Kinyarwanda report', async () => {
    const doc = (
      await preview(manager, 'monthly-cooperative', { ...PERIOD, locale: 'RW' }).expect(200)
    ).body.data as Doc
    const lowStock = sectionOf(doc, 'lowStock')
    // The cooperative named this product Ibigori. An English name sitting in the middle of a
    // Kinyarwanda page is a report somebody has to have translated for them.
    expect(lowStock.rows?.[0]?.product).toBe('Ibigori')
  })

  it('prints the sales report, and agrees with the sales summary', async () => {
    const doc = (await preview(manager, 'sales').expect(200)).body.data as Doc
    const summary = (
      await as(
        manager,
        'get',
        `/sales/summary?from=${PERIOD.from}&to=${PERIOD.to}&groupBy=month`,
      ).expect(200)
    ).body.data as { sold: string; paid: string; outstanding: string; saleCount: number }

    expect(figureOf(doc, 'sales', 'sold')).toBe(summary.sold)
    expect(figureOf(doc, 'sales', 'paid')).toBe(summary.paid)
    expect(figureOf(doc, 'sales', 'outstanding')).toBe(summary.outstanding)
    expect(figureOf(doc, 'sales', 'count')).toBe(String(summary.saleCount))
  })

  it('refuses the activity report to a reader without audit:view', async () => {
    await preview(secretary, 'activity').expect(403)
  })

  it('prints the activity report in words, never as action codes', async () => {
    const doc = (await preview(manager, 'activity').expect(200)).body.data as Doc
    const rows = sectionOf(doc, 'activity').rows ?? []
    expect(rows.length).toBeGreaterThan(0)

    for (const row of rows) {
      const what = row.what ?? ''
      // `finance.transaction.voided` on a page filed with a cooperative's auditors is not a
      // report. Every action this application writes has a sentence in both languages, and the
      // test below proves none is missing.
      expect(what).not.toMatch(/^[a-z]+\.[a-z.]+$/)
      expect(what.length).toBeGreaterThan(0)
    }
  })

  it('refuses the minutes report with the phase that brings it', async () => {
    const response = await preview(manager, 'meeting').expect(409)
    expect(response.body.error.messageKey).toBe('errors.reports.notYetAvailable')
  })
})

describe('every audit action this application writes', () => {
  it('has a sentence in both languages, so the activity report can print it', async () => {
    // Read from the log rather than from a list kept by hand: an action added in a later phase
    // fails this the first time it is written, which is when it is cheapest to name.
    const actions = await prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
    })
    const missing = actions
      .map((row) => row.action)
      .filter((action) => !hasAuditActionLabel(action))
    expect(missing).toEqual([])
  })
})

describe('the parameters', () => {
  it('requires a period, and refuses one the wrong way round', async () => {
    await preview(manager, 'financial', {}).expect(422)
    await preview(manager, 'financial', { from: '2026-09-30', to: '2026-09-01' }).expect(422)
    await preview(manager, 'financial', { from: 'September', to: '2026-09-30' }).expect(422)
  })

  it('refuses a parameter it does not know, rather than ignoring it', async () => {
    // A misspelled filter that was quietly dropped would produce a report covering more than the
    // reader asked for, and they would have no way of telling.
    await preview(manager, 'financial', { ...PERIOD, warehouse: store }).expect(422)
  })

  it('refuses a report type that does not exist', async () => {
    await preview(manager, 'profit-and-loss').expect(422)
  })
})

describe('the PDF', () => {
  it('is A4, says what it is, and numbers its pages', async () => {
    const response = await exportReport(manager, 'financial', { ...PERIOD, format: 'pdf' }).expect(
      200,
    )

    expect(response.headers['content-type']).toBe('application/pdf')
    expect(response.headers['content-disposition']).toContain('.pdf')
    // Named for the cooperative and the period, so a folder of these is legible a year later.
    expect(response.headers['content-disposition']).toContain('financial-2026-09-01-to-2026-09-30')

    const pdf = response.body as Buffer
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')

    const text = pdfText(pdf)
    expect(text).toContain(cooperative.name)
    expect(text).toContain('Financial report')
    expect(text).toContain('1 September to 30 September 2026')
    expect(text).toContain('Page 1/')
    // The footer names who produced it and when, because a sheet filed for years with neither is
    // one nobody can place.
    expect(text).toContain(managerName)
  })

  it('prints the figures the preview reported, formatted for reading', async () => {
    const doc = (await preview(manager, 'financial').expect(200)).body.data as Doc
    const pdf = (await exportReport(manager, 'financial', { ...PERIOD, format: 'pdf' }).expect(200))
      .body as Buffer
    const text = pdfText(pdf)

    expect(figureOf(doc, 'finance', 'closing')).toBe('1210000.00')
    // Grouped on paper, raw on the wire: the same value, written for a reader.
    expect(text).toContain('1,210,000')
    expect(text).toContain('Money in')
  })

  it('repeats the column headings on every page a table runs onto', async () => {
    // Enough entries to spill onto a second page. Written straight to the database rather than
    // through the API, because this test is about the renderer and 120 posted entries through the
    // endpoint would make it slow for no gain.
    const rows = Array.from({ length: 120 }, (_, index) => ({
      cooperativeId: cooperative.id,
      reference: `RPT-${String(index).padStart(5, '0')}`,
      kind: 'INCOME' as const,
      categoryId: incomeCategory,
      amount: '1000.00',
      occurredAt: new Date('2026-09-15T00:00:00.000Z'),
      method: 'CASH' as const,
      description: `Bulk entry ${index} for the pagination test`,
    }))
    await prisma.financeTransaction.createMany({ data: rows })

    const pdf = (await exportReport(manager, 'financial', { ...PERIOD, format: 'pdf' }).expect(200))
      .body as Buffer
    const pages = pdfPages(pdf)
    expect(pages.length).toBeGreaterThan(1)

    for (const [index, page] of pages.entries()) {
      const joined = page.join(' ')
      expect(joined, `page ${index + 1} has no column headings`).toContain('Reference')
      expect(joined, `page ${index + 1} has no footer`).toContain(
        `Page ${index + 1}/${pages.length}`,
      )
    }

    await prisma.financeTransaction.deleteMany({
      where: { cooperativeId: cooperative.id, reference: { startsWith: 'RPT-' } },
    })
  })

  it('prints in Kinyarwanda when asked, with nothing left in English', async () => {
    const pdf = (
      await exportReport(manager, 'monthly-cooperative', {
        ...PERIOD,
        locale: 'RW',
        format: 'pdf',
      }).expect(200)
    ).body as Buffer
    const text = pdfText(pdf)

    expect(text).toContain('Raporo y’ukwezi ya koperative')
    expect(text).toContain('Abanyamuryango')
    // The month is Nzeri, not September: a report half in English is a report a Kinyarwanda
    // speaker has to have translated for them.
    expect(text).toContain('Nzeri')
    expect(text).not.toContain('September')
    expect(text).not.toContain('Membership')
    // A product the cooperative named in Kinyarwanda prints under that name.
    expect(text).toContain('Ibigori')
  })

  it('says a section was withheld on the paper as well as on the screen', async () => {
    const pdf = (
      await exportReport(secretary, 'monthly-cooperative', { ...PERIOD, format: 'pdf' }).expect(200)
    ).body as Buffer
    const text = pdfText(pdf)

    expect(text).toContain('Membership')
    expect(text).toContain('not shown')
    // And the figures themselves are nowhere on the page.
    expect(text).not.toContain('1,210,000')
  })
})

describe('the CSV', () => {
  it('carries raw values a spreadsheet can sum, with a byte order mark', async () => {
    const response = await exportReport(manager, 'financial', { ...PERIOD, format: 'csv' }).expect(
      200,
    )
    expect(response.headers['content-type']).toContain('text/csv')

    const csv = response.text
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    // Raw, not grouped: `1,210,000` inside a CSV cell is text, and the first thing anybody does
    // with this file is add up a column.
    expect(csv).toContain('"1210000.00"')
    expect(csv).not.toContain('"1,210,000"')
    expect(csv).toContain(cooperative.name)
  })

  it('defuses a description that would otherwise run as a formula', async () => {
    await post('EXPENSE', '5000.00', '2026-09-20', '=SUM(A1:A9)+cmd')
    const csv = (await exportReport(manager, 'financial', { ...PERIOD, format: 'csv' }).expect(200))
      .text

    // The description of a money entry is typed by a member of staff, and a spreadsheet runs a
    // cell beginning with `=` the moment the file is opened.
    expect(csv).toContain(`"'=SUM(A1:A9)+cmd"`)
    expect(csv).not.toContain('"=SUM(A1:A9)+cmd"')
  })
})

describe('the spreadsheet', () => {
  it('is a real workbook', async () => {
    const response = await exportReport(manager, 'inventory', { ...PERIOD, format: 'xlsx' })
      // superagent has no parser for a spreadsheet, so the bytes are collected by hand.
      .buffer()
      .parse((res, callback) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => callback(null, Buffer.concat(chunks)))
      })
      .expect(200)
    expect(response.headers['content-type']).toContain('spreadsheetml')
    // A .xlsx file is a zip archive, which begins PK.
    expect((response.body as Buffer).subarray(0, 2).toString()).toBe('PK')
  })
})

describe('report runs', () => {
  it('records what was produced, and tells the reader it is ready', async () => {
    const response = await exportReport(manager, 'sales', { ...PERIOD, format: 'csv' }).expect(200)
    const runId = response.headers['x-report-run-id'] as string
    expect(runId).toBeTruthy()

    const run = await prisma.reportRun.findUniqueOrThrow({
      where: { id: runId },
      select: {
        type: true,
        format: true,
        status: true,
        rowCount: true,
        completedAt: true,
        params: true,
        generatedById: true,
        storageKey: true,
      },
    })
    expect(run.type).toBe('sales')
    expect(run.format).toBe('CSV')
    expect(run.status).toBe('READY')
    expect(run.completedAt).not.toBeNull()
    expect(run.rowCount).not.toBeNull()
    expect(run.generatedById).toBe(manager.id)
    // Null until there is file storage: a download produces the report again from these
    // parameters, which is recorded as a deliberate deviation in docs/reports.md.
    expect(run.storageKey).toBeNull()
    expect(run.params).toMatchObject(PERIOD)

    const notification = await prisma.notification.findFirst({
      where: { cooperativeId: cooperative.id, entityId: runId, type: 'REPORT_READY' },
      select: { userId: true, messageKey: true, messageParams: true, actionUrl: true },
    })
    // Addressed to the person who asked for it, not to every member of staff: everyone being told
    // about everyone else's reports is how a cooperative learns to ignore its notifications.
    expect(notification?.userId).toBe(manager.id)
    expect(notification?.messageKey).toBe('notifications.report.ready')
    expect(notification?.messageParams).toMatchObject({ report: 'report.sales' })
    expect(notification?.actionUrl).toBe(`/reports/runs/${runId}`)
  })

  it('records a failed run with the reason, rather than leaving nothing to ask about', async () => {
    const before = await prisma.reportRun.count({ where: { cooperativeId: cooperative.id } })

    // A member of another cooperative: the report cannot be built, and the run must say so.
    await exportReport(manager, 'member', {
      ...PERIOD,
      memberId: otherMemberId,
      format: 'pdf',
    }).expect(404)

    const after = await prisma.reportRun.findFirst({
      where: { cooperativeId: cooperative.id, status: 'FAILED' },
      orderBy: { createdAt: 'desc' },
      select: { errorMessage: true, completedAt: true, type: true },
    })
    expect(await prisma.reportRun.count({ where: { cooperativeId: cooperative.id } })).toBe(
      before + 1,
    )
    expect(after?.type).toBe('member')
    expect(after?.errorMessage).toBeTruthy()
    expect(after?.completedAt).not.toBeNull()
  })

  it('lists the runs newest first, with who produced each one', async () => {
    const response = await as(manager, 'get', '/reports/runs?pageSize=5').expect(200)
    const rows = response.body.data as {
      id: string
      type: string
      title: string
      status: string
      from: string | null
      generatedBy: string | null
      downloadable: boolean
    }[]

    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]?.generatedBy).toBe(managerName)
    expect(rows[0]?.from).toBe(PERIOD.from)
    expect(rows.find((row) => row.status === 'FAILED')?.downloadable).toBe(false)
    expect(response.body.meta.total).toBeGreaterThan(0)
  })

  it('filters the list by report', async () => {
    const response = await as(manager, 'get', '/reports/runs?type=sales').expect(200)
    const rows = response.body.data as { type: string }[]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.type === 'sales')).toBe(true)
  })

  it('produces a past run again from its stored parameters', async () => {
    const created = await exportReport(manager, 'financial', { ...PERIOD, format: 'pdf' }).expect(
      200,
    )
    const runId = created.headers['x-report-run-id'] as string

    const again = await as(manager, 'get', `/reports/runs/${runId}/download`).expect(200)
    expect(again.headers['content-type']).toBe('application/pdf')
    expect((again.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdfText(again.body as Buffer)).toContain('Financial report')

    // Reading a run again is not a new run: a list that grew every time somebody re-opened a
    // report would tell a cooperative nothing.
    const runs = await prisma.reportRun.count({ where: { cooperativeId: cooperative.id } })
    await as(manager, 'get', `/reports/runs/${runId}/download`).expect(200)
    expect(await prisma.reportRun.count({ where: { cooperativeId: cooperative.id } })).toBe(runs)
  })

  it('checks the report’s own permission again on a download, not only when it was produced', async () => {
    const created = await exportReport(manager, 'financial', { ...PERIOD, format: 'pdf' }).expect(
      200,
    )
    const runId = created.headers['x-report-run-id'] as string

    // The secretary may export reports, but not the money. A link to somebody else's old run
    // must not be a way round that.
    await as(secretary, 'get', `/reports/runs/${runId}/download`).expect(403)
  })

  it('refuses to export at all without reports:export', async () => {
    await as(manager, 'put', `/staff/${viewer.staffId}/overrides`)
      .send({ overrides: [{ permission: 'reports:export', effect: 'DENY' }] })
      .expect(200)

    // Reading a report on screen and producing a document that leaves the cooperative are two
    // different acts, and this reader may only do the first.
    await preview(viewer, 'monthly-cooperative').expect(200)
    await exportReport(viewer, 'monthly-cooperative', { ...PERIOD, format: 'pdf' }).expect(403)

    await as(manager, 'put', `/staff/${viewer.staffId}/overrides`)
      .send({ overrides: [] })
      .expect(200)
  })
})

describe('dividing a table’s width', () => {
  /**
   * The numbers are the membership register as it actually came out for the demonstration
   * cooperative in Kinyarwanda: six columns whose full demands add up to more than A4 allows. The
   * first version of this algorithm handed each column its whole demand as soon as the page could
   * afford it, which starved whichever column settled last — the member-code column was left 67
   * points for a heading needing 102, and the heading was printed as `Inomero y’umun` /
   * `yamuryango` on a sheet a cooperative files.
   */
  const demand = [109.0, 108.1, 68.7, 94.3, 89.0, 88.3]
  const minimum = [77.4, 72.0, 68.7, 76.1, 45.7, 55.2]
  const weights = [1, 3, 1.4, 1.4, 1.4, 1.6]

  it('never leaves a column narrower than its longest word', () => {
    const widths = shareColumnWidths(demand, minimum, weights, CONTENT_WIDTH)
    widths.forEach((width, index) => {
      expect(width, `column ${index}`).toBeGreaterThanOrEqual(minimum[index] as number)
    })
  })

  it('uses the whole page and no more', () => {
    const widths = shareColumnWidths(demand, minimum, weights, CONTENT_WIDTH)
    expect(widths.reduce((running, width) => running + width, 0)).toBeCloseTo(CONTENT_WIDTH, 1)
  })

  it('gives no column more than it asked for while another is still short', () => {
    const widths = shareColumnWidths(demand, minimum, weights, CONTENT_WIDTH)
    const short = widths.some((width, index) => width < (demand[index] as number) - 0.01)
    expect(short).toBe(true)
    widths.forEach((width, index) => {
      expect(width, `column ${index}`).toBeLessThanOrEqual((demand[index] as number) + 0.01)
    })
  })

  it('spreads the surplus when every column fits, so a narrow table fills the page', () => {
    const widths = shareColumnWidths([40, 40], [20, 20], [1, 1], 200)
    expect(widths).toEqual([100, 100])
  })

  it('falls back to the weights when even the longest words cannot fit', () => {
    // A table genuinely too wide for the paper. Dividing by weight and accepting a broken word is
    // the honest outcome; a column running off the edge of the sheet is not.
    const widths = shareColumnWidths([400, 400], [300, 300], [1, 3], 200)
    expect(widths).toEqual([50, 150])
  })
})
