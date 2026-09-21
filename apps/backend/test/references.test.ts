import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { disconnectPrisma, prisma } from '../src/lib/prisma.js'
import {
  financePrefixFor,
  nextFinanceReference,
  nextInventoryReference,
  nextMeetingReference,
  nextMemberCode,
  nextSaleReference,
} from '../src/lib/references.js'
import { cleanupFixtures, createCooperative, type TestCooperative } from './fixtures.js'

/**
 * Code allocation, tested where it lives: inside real transactions against the real database.
 *
 * The property every allocator has to hold is that two people acting at the same moment are never
 * handed the same number, and the only way to know that is to have many transactions ask at once
 * and count what comes back. A mock of the database would test the mock.
 *
 * The other properties — per cooperative, per year, zero-padded so they sort as text — are cheap
 * to state and would be expensive to lose: a receipt number is read aloud down a phone line, and a
 * cooperative's paper files are sorted by it.
 */
let cooperative: TestCooperative
let other: TestCooperative
let incomeCategoryId: string

beforeAll(async () => {
  cooperative = await createCooperative('References Test Cooperative')
  other = await createCooperative('Other References Cooperative')
  const category = await prisma.financeCategory.create({
    data: { cooperativeId: cooperative.id, kind: 'INCOME', name: 'Fees' },
    select: { id: true },
  })
  incomeCategoryId = category.id
})

afterAll(async () => {
  await cleanupFixtures()
  await disconnectPrisma()
})

/** The counter a finance reference is read from is the rows already posted, so post one. */
async function postIncome(cooperativeId: string, occurredAt: Date): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const reference = await nextFinanceReference(tx, cooperativeId, 'IN', occurredAt)
    await tx.financeTransaction.create({
      data: {
        cooperativeId,
        reference,
        kind: 'INCOME',
        categoryId: incomeCategoryId,
        amount: '100',
        occurredAt,
        method: 'CASH',
        description: `allocated ${reference}`,
      },
    })
    return reference
  })
}

describe('member codes', () => {
  it('count up from one, five digits wide, under the cooperative’s prefix', async () => {
    const first = await prisma.$transaction((tx) => nextMemberCode(tx, cooperative.id))
    const second = await prisma.$transaction((tx) => nextMemberCode(tx, cooperative.id))
    const prefix = (
      await prisma.cooperative.findUniqueOrThrow({
        where: { id: cooperative.id },
        select: { memberCodePrefix: true },
      })
    ).memberCodePrefix
    expect(first).toBe(`${prefix}-00001`)
    expect(second).toBe(`${prefix}-00002`)
  })

  it('never hand two of forty simultaneous registrations the same code', async () => {
    const codes = await Promise.all(
      Array.from({ length: 40 }, () =>
        prisma.$transaction((tx) => nextMemberCode(tx, cooperative.id)),
      ),
    )
    expect(new Set(codes).size).toBe(40)
    // And no number was skipped: forty allocations are forty consecutive numbers.
    const numbers = codes.map((code) => Number(code.slice(-5))).sort((a, b) => a - b)
    expect((numbers[39] as number) - (numbers[0] as number)).toBe(39)
  })

  it('are counted per cooperative, so a second cooperative also starts at one', async () => {
    const code = await prisma.$transaction((tx) => nextMemberCode(tx, other.id))
    expect(code.endsWith('-00001')).toBe(true)
  })

  it('refuse to allocate for a cooperative that does not exist', async () => {
    await expect(
      prisma.$transaction((tx) => nextMemberCode(tx, '00000000-0000-4000-8000-000000000000')),
    ).rejects.toThrow(/not found/)
  })
})

describe('finance references', () => {
  it('carry the direction and the year, six digits wide', async () => {
    const reference = await postIncome(cooperative.id, new Date('2026-04-10'))
    expect(reference).toMatch(/^IN-2026-\d{6}$/)
    expect(financePrefixFor('INCOME')).toBe('IN')
    expect(financePrefixFor('EXPENSE')).toBe('EX')
  })

  it('restart each January, because that is how the paper is filed', async () => {
    const lastYear = await postIncome(cooperative.id, new Date('2025-12-31'))
    const thisYear = await postIncome(cooperative.id, new Date('2026-01-01'))
    expect(lastYear).toBe('IN-2025-000001')
    // 2026 already has the entry from the test above, so this is its second.
    expect(thisYear).toBe('IN-2026-000002')
  })

  it('serialise thirty simultaneous postings to thirty different numbers', async () => {
    const references = await Promise.all(
      Array.from({ length: 30 }, () => postIncome(cooperative.id, new Date('2026-06-01'))),
    )
    expect(new Set(references).size).toBe(30)
    // The unique index on (cooperative, reference) is the last line of defence; the lock on the
    // cooperative row is what keeps it from ever being needed.
    const stored = await prisma.financeTransaction.count({
      where: { cooperativeId: cooperative.id, reference: { startsWith: 'IN-2026-' } },
    })
    expect(stored).toBe(32)
  })
})

describe('the other counters', () => {
  it('share the shape: a prefix, the year, and six digits from one', async () => {
    const when = new Date('2026-09-15')
    const stock = await prisma.$transaction((tx) => nextInventoryReference(tx, other.id, when))
    const sale = await prisma.$transaction((tx) => nextSaleReference(tx, other.id, when))
    const meeting = await prisma.$transaction((tx) => nextMeetingReference(tx, other.id, when))
    expect(stock).toBe('STK-2026-000001')
    expect(sale).toBe('SL-2026-000001')
    expect(meeting).toBe('MTG-2026-000001')
  })

  it('sort as text in the order they were issued, which is what a filing cabinet needs', () => {
    const issued = ['IN-2026-000009', 'IN-2026-000010', 'IN-2026-000100']
    expect([...issued].sort()).toEqual(issued)
  })
})
