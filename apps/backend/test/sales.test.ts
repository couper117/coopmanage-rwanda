import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HEADERS } from '@coopmanage/shared'
import { API_PREFIX } from '../src/app.js'
import { disconnectPrisma, prisma } from '../src/lib/prisma.js'
import { rebuildStockLevels } from '../src/modules/inventory/rebuild.js'
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
let storekeeper: TestUser & Session & { staffId: string }
let viewer: TestUser & Session & { staffId: string }

let store: string
let maize: string
let beans: string
let buyer: string
let incomeCategory: string

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

interface Yard {
  store: string
  maize: string
  buyer: string
  incomeCategory: string
}

/** A cooperative with a store, two products in stock, a buyer and an income category. */
async function setUpYard(coop: TestCooperative, owner: Session): Promise<Yard> {
  const units = await as(owner, 'get', '/units', coop).expect(200)
  const unitId = (units.body.data as { key: string; id: string }[]).find((row) => row.key === 'KG')
    ?.id as string

  const warehouse = await as(owner, 'post', '/warehouses', coop)
    .send({ name: 'Main store' })
    .expect(201)
  const product = await as(owner, 'post', '/products', coop)
    .send({ name: 'Maize grain', unitId, defaultSalePrice: '450' })
    .expect(201)
  await as(owner, 'post', '/inventory/receive', coop)
    .send({
      productId: product.body.data.id,
      warehouseId: warehouse.body.data.id,
      quantity: '1000',
    })
    .expect(201)

  const buyerRow = await as(owner, 'post', '/buyers', coop)
    .send({ name: 'District buyer' })
    .expect(201)
  const category = await prisma.financeCategory.create({
    data: { cooperativeId: coop.id, kind: 'INCOME', name: 'Sale of produce' },
    select: { id: true },
  })

  return {
    store: warehouse.body.data.id as string,
    maize: product.body.data.id as string,
    buyer: buyerRow.body.data.id as string,
    incomeCategory: category.id,
  }
}

/** A draft sale of one line. */
async function draft(
  overrides: Record<string, unknown> = {},
  session: Session = manager,
  coop: TestCooperative = cooperative,
  yard: { store: string; maize: string; buyer: string } = { store, maize, buyer },
): Promise<{ id: string; reference: string; total: string }> {
  const response = await as(session, 'post', '/sales', coop)
    .send({
      buyerId: yard.buyer,
      warehouseId: yard.store,
      lines: [{ productId: yard.maize, quantity: '100', unitPrice: '450' }],
      ...overrides,
    })
    .expect(201)
  return response.body.data as { id: string; reference: string; total: string }
}

async function levelOf(productId: string, warehouseId: string): Promise<string> {
  const level = await prisma.stockLevel.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    select: { quantity: true },
  })
  return level?.quantity.toString() ?? 'none'
}

beforeAll(async () => {
  cooperative = await createCooperative('Sales Test Cooperative')
  manager = await createStaffSession(app, cooperative, 'MANAGER')
  accountant = await createStaffSession(app, cooperative, 'ACCOUNTANT')
  storekeeper = await createStaffSession(app, cooperative, 'INVENTORY_OFFICER')
  viewer = await createStaffSession(app, cooperative, 'VIEWER')

  const yard = await setUpYard(cooperative, manager)
  store = yard.store
  maize = yard.maize
  buyer = yard.buyer
  incomeCategory = yard.incomeCategory

  const units = await as(manager, 'get', '/units').expect(200)
  const unitId = (units.body.data as { key: string; id: string }[]).find((row) => row.key === 'KG')
    ?.id as string
  const second = await as(manager, 'post', '/products')
    .send({ name: 'Bean seed', unitId })
    .expect(201)
  beans = second.body.data.id as string
  await as(manager, 'post', '/inventory/receive')
    .send({ productId: beans, warehouseId: store, quantity: '50' })
    .expect(201)
}, 90_000)

afterAll(async () => {
  await cleanupFixtures()
  await disconnectPrisma()
})

describe('buyers', () => {
  it('needs a name and nothing else', async () => {
    const response = await as(manager, 'post', '/buyers')
      .send({ name: 'Kigali wholesaler' })
      .expect(201)

    // Whoever records a sale at the store has the buyer's name and may have nothing else.
    expect(response.body.data.phone).toBeNull()
    expect(response.body.data.tin).toBeNull()
    expect(response.body.data.isActive).toBe(true)
    expect(response.body.data.saleCount).toBe(0)
    expect(response.body.data.totalSold).toBe('0.00')
  })

  it('refuses a duplicate name and an empty one', async () => {
    await as(manager, 'post', '/buyers').send({ name: 'Only once' }).expect(201)
    const duplicate = await as(manager, 'post', '/buyers').send({ name: 'Only once' }).expect(409)
    expect(duplicate.body.error.messageKey).toBe('errors.sales.buyerNameTaken')

    await as(manager, 'post', '/buyers').send({ name: '   ' }).expect(422)
  })

  it('has no delete route, and takes a buyer out of use instead', async () => {
    const created = await as(manager, 'post', '/buyers').send({ name: 'To retire' }).expect(201)
    const id = created.body.data.id as string

    const response = await request(app)
      .delete(`${API_PREFIX}/buyers/${id}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set(HEADERS.cooperativeId, cooperative.id)
    // Every confirmed sale names them, and a report has to be able to say who bought the maize.
    expect(response.status).toBe(404)

    await as(manager, 'patch', `/buyers/${id}`).send({ isActive: false }).expect(200)
    expect(await prisma.buyer.findUnique({ where: { id } })).not.toBeNull()
  })

  it('counts only confirmed sales towards a buyer total', async () => {
    const coop = await createCooperative('Buyer Totals Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)

    const first = await draft({}, owner, coop, yard)
    await draft({}, owner, coop, yard)

    let profile = await as(owner, 'get', `/buyers/${yard.buyer}`, coop).expect(200)
    // A draft is an intention somebody typed, not business the cooperative did.
    expect(profile.body.data.saleCount).toBe(0)
    expect(profile.body.data.totalSold).toBe('0.00')

    await as(owner, 'post', `/sales/${first.id}/confirm`, coop).send({}).expect(200)

    profile = await as(owner, 'get', `/buyers/${yard.buyer}`, coop).expect(200)
    expect(profile.body.data.saleCount).toBe(1)
    expect(profile.body.data.totalSold).toBe('45000.00')
    expect(profile.body.data.outstanding).toBe('45000.00')
  })

  it('needs both permissions for a buyer history', async () => {
    // A buyer's history is a sales question as much as a buyer one.
    await as(storekeeper, 'get', `/buyers/${buyer}`).expect(200)
    await as(storekeeper, 'get', `/buyers/${buyer}/summary`).expect(200)
    await as(viewer, 'get', `/buyers/${buyer}/summary`).expect(200)
  })

  it('lets a storekeeper manage buyers but not a viewer', async () => {
    await as(storekeeper, 'post', '/buyers').send({ name: 'Added by the store' }).expect(201)
    await as(viewer, 'post', '/buyers').send({ name: 'Not allowed' }).expect(403)
  })
})

describe('writing up a sale', () => {
  it('prices each line and totals the sale', async () => {
    const response = await as(manager, 'post', '/sales')
      .send({
        buyerId: buyer,
        warehouseId: store,
        lines: [
          { productId: maize, quantity: '120.5', unitPrice: '450' },
          { productId: beans, quantity: '10', unitPrice: '1250.50' },
        ],
        discount: '1000',
        taxAmount: '500',
      })
      .expect(201)

    const sale = response.body.data
    // 120.5 x 450 = 54,225 and 10 x 1250.50 = 12,505.
    expect(sale.subtotal).toBe('66730.00')
    expect(sale.discount).toBe('1000.00')
    expect(sale.taxAmount).toBe('500.00')
    expect(sale.total).toBe('66230.00')
    expect(sale.status).toBe('DRAFT')
    expect(sale.paymentStatus).toBe('UNPAID')
    expect(sale.reference).toMatch(/^SL-\d{4}-\d{6}$/)
    expect(sale.lines).toHaveLength(2)
    expect(sale.lines[0].lineTotal).toBe('54225.00')
  })

  it('takes no stock and records no money while it is a draft', async () => {
    const before = await levelOf(maize, store)
    const sale = await draft()

    // A sale is often written up before the stock is counted. Refusing a draft because the shelf
    // is short would stop somebody recording an order they are about to go and fill.
    expect(await levelOf(maize, store)).toBe(before)
    const movements = await prisma.inventoryTransaction.count({ where: { saleId: sale.id } })
    expect(movements).toBe(0)
    const finance = await prisma.financeTransaction.count({ where: { saleId: sale.id } })
    expect(finance).toBe(0)
  })

  it('accepts a draft for more than there is in the store', async () => {
    // The stock is checked when it actually leaves, not when the order is written down.
    const sale = await draft({
      lines: [{ productId: maize, quantity: '999999', unitPrice: '450' }],
    })
    expect(sale.total).toBe('449999550.00')
  })

  it('refuses a sale with no lines', async () => {
    await as(manager, 'post', '/sales')
      .send({ buyerId: buyer, warehouseId: store, lines: [] })
      .expect(422)
  })

  it('refuses a discount larger than the sale', async () => {
    // A discount bigger than what is being discounted turns the total negative and every report
    // that sums sales quietly goes wrong.
    const response = await as(manager, 'post', '/sales')
      .send({
        buyerId: buyer,
        warehouseId: store,
        lines: [{ productId: maize, quantity: '10', unitPrice: '100' }],
        discount: '5000',
      })
      .expect(422)
    expect(response.body.error.details[0].messageKey).toBe('validation.discountTooLarge')
  })

  it('accepts a line given away, at a price of nothing', async () => {
    const sale = await draft({
      lines: [{ productId: maize, quantity: '5', unitPrice: '0', note: 'Sample for the buyer' }],
    })
    // A cooperative does give something away with a sale, and this is how that is recorded rather
    // than by leaving it off the receipt.
    expect(sale.total).toBe('0.00')
  })

  it('rejects a quantity or a price with too many decimal places', async () => {
    for (const line of [
      { productId: maize, quantity: '10.0005', unitPrice: '450' },
      { productId: maize, quantity: '10', unitPrice: '450.005' },
      { productId: maize, quantity: '0', unitPrice: '450' },
    ]) {
      await as(manager, 'post', '/sales')
        .send({ buyerId: buyer, warehouseId: store, lines: [line] })
        .expect(422)
    }
  })

  it('refuses a product, buyer or store from another cooperative', async () => {
    const other = await createCooperative('Foreign Sale Cooperative')
    const otherOwner = await createStaffSession(app, other, 'MANAGER')
    const foreign = await setUpYard(other, otherOwner)

    for (const body of [
      {
        buyerId: foreign.buyer,
        warehouseId: store,
        lines: [{ productId: maize, quantity: '1', unitPrice: '1' }],
      },
      {
        buyerId: buyer,
        warehouseId: foreign.store,
        lines: [{ productId: maize, quantity: '1', unitPrice: '1' }],
      },
      {
        buyerId: buyer,
        warehouseId: store,
        lines: [{ productId: foreign.maize, quantity: '1', unitPrice: '1' }],
      },
    ]) {
      await as(manager, 'post', '/sales').send(body).expect(422)
    }
  })

  it('refuses a retired product on a line', async () => {
    const units = await as(manager, 'get', '/units').expect(200)
    const unitId = (units.body.data as { key: string; id: string }[]).find(
      (row) => row.key === 'KG',
    )?.id as string
    const product = await as(manager, 'post', '/products')
      .send({ name: 'Retired for sale', unitId })
      .expect(201)
    await as(manager, 'patch', `/products/${product.body.data.id as string}`)
      .send({ isActive: false })
      .expect(200)

    const response = await as(manager, 'post', '/sales')
      .send({
        buyerId: buyer,
        warehouseId: store,
        lines: [{ productId: product.body.data.id, quantity: '1', unitPrice: '1' }],
      })
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.sales.productRetired')
  })

  it('replaces the lines wholesale when a draft is edited', async () => {
    const sale = await draft()
    const response = await as(manager, 'patch', `/sales/${sale.id}`)
      .send({ lines: [{ productId: beans, quantity: '4', unitPrice: '1000' }] })
      .expect(200)

    expect(response.body.data.lines).toHaveLength(1)
    expect(response.body.data.lines[0].productId).toBe(beans)
    expect(response.body.data.total).toBe('4000.00')
  })

  it('lets a viewer read a sale but not write one', async () => {
    await as(viewer, 'get', '/sales').expect(200)
    await as(viewer, 'post', '/sales')
      .send({
        buyerId: buyer,
        warehouseId: store,
        lines: [{ productId: maize, quantity: '1', unitPrice: '1' }],
      })
      .expect(403)
  })
})

describe('confirming a sale', () => {
  it('takes the stock, writes a movement per line and marks the sale, in one act', async () => {
    const coop = await createCooperative('Confirm Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)

    const sale = await draft({}, owner, coop, yard)
    const response = await as(owner, 'post', `/sales/${sale.id}/confirm`, coop).send({}).expect(200)

    expect(response.body.data.status).toBe('CONFIRMED')
    expect(response.body.data.confirmedAt).not.toBeNull()
    expect(response.body.data.paymentStatus).toBe('UNPAID')
    expect(response.body.data.movements).toHaveLength(1)

    expect(await levelOf(yard.maize, yard.store)).toBe('900')

    const movement = await prisma.inventoryTransaction.findFirstOrThrow({
      where: { saleId: sale.id },
      select: { type: true, direction: true, quantity: true, buyerId: true },
    })
    expect(movement.type).toBe('SALE_OUT')
    expect(movement.direction).toBe('OUT')
    expect(movement.quantity.toString()).toBe('100')
    expect(movement.buyerId).toBe(yard.buyer)
  })

  it('records the payment in the same transaction when money is taken at the counter', async () => {
    const coop = await createCooperative('Paid Confirm Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)
    const sale = await draft({}, owner, coop, yard)

    const response = await as(owner, 'post', `/sales/${sale.id}/confirm`, coop)
      .send({ amountPaid: '45000', method: 'MOBILE_MONEY', incomeCategoryId: yard.incomeCategory })
      .expect(200)

    expect(response.body.data.paymentStatus).toBe('PAID')
    expect(response.body.data.amountPaid).toBe('45000.00')
    expect(response.body.data.outstanding).toBe('0.00')
    expect(response.body.data.payments).toHaveLength(1)

    const entry = await prisma.financeTransaction.findFirstOrThrow({
      where: { saleId: sale.id },
      select: { kind: true, amount: true, sourceType: true, buyerId: true },
    })
    expect(entry.kind).toBe('INCOME')
    expect(entry.amount.toString()).toBe('45000')
    expect(entry.sourceType).toBe('SALE')
    expect(entry.buyerId).toBe(yard.buyer)
  })

  it('marks a part payment as partial', async () => {
    const coop = await createCooperative('Partial Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)
    const sale = await draft({}, owner, coop, yard)

    const response = await as(owner, 'post', `/sales/${sale.id}/confirm`, coop)
      .send({ amountPaid: '20000', method: 'CASH', incomeCategoryId: yard.incomeCategory })
      .expect(200)
    expect(response.body.data.paymentStatus).toBe('PARTIAL')
    expect(response.body.data.outstanding).toBe('25000.00')
  })

  it('refuses a payment larger than the sale', async () => {
    const coop = await createCooperative('Overpaid Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)
    const sale = await draft({}, owner, coop, yard)

    // Taking more than the sale is worth is a data-entry slip, not a payment.
    await as(owner, 'post', `/sales/${sale.id}/confirm`, coop)
      .send({ amountPaid: '99999', method: 'CASH', incomeCategoryId: yard.incomeCategory })
      .expect(422)
  })

  it('refuses a payment that does not say where the money goes', async () => {
    const sale = await draft()
    await as(manager, 'post', `/sales/${sale.id}/confirm`)
      .send({ amountPaid: '1000', method: 'CASH' })
      .expect(422)
  })

  it('refuses to confirm a sale the store cannot fill', async () => {
    const coop = await createCooperative('Short Confirm Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)

    const sale = await draft(
      { lines: [{ productId: yard.maize, quantity: '5000', unitPrice: '450' }] },
      owner,
      coop,
      yard,
    )
    const response = await as(owner, 'post', `/sales/${sale.id}/confirm`, coop).send({}).expect(409)
    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK')

    // Still a draft, and the stock untouched.
    const still = await as(owner, 'get', `/sales/${sale.id}`, coop).expect(200)
    expect(still.body.data.status).toBe('DRAFT')
    expect(await levelOf(yard.maize, yard.store)).toBe('1000')
  })

  it('refuses to confirm the same sale twice, or a cancelled one', async () => {
    const coop = await createCooperative('Twice Confirm Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)

    const sale = await draft({}, owner, coop, yard)
    await as(owner, 'post', `/sales/${sale.id}/confirm`, coop).send({}).expect(200)
    const again = await as(owner, 'post', `/sales/${sale.id}/confirm`, coop).send({}).expect(409)
    expect(again.body.error.messageKey).toBe('errors.sales.alreadyConfirmed')

    const other = await draft({}, owner, coop, yard)
    await as(owner, 'post', `/sales/${other.id}/cancel`, coop)
      .send({ reason: 'Buyer changed their mind' })
      .expect(200)
    const cancelled = await as(owner, 'post', `/sales/${other.id}/confirm`, coop)
      .send({})
      .expect(409)
    expect(cancelled.body.error.messageKey).toBe('errors.sales.cancelled')
  })

  it('never lets a confirmed sale go back to being a draft', async () => {
    const coop = await createCooperative('No Return Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)
    const sale = await draft({}, owner, coop, yard)
    await as(owner, 'post', `/sales/${sale.id}/confirm`, coop).send({}).expect(200)

    const response = await as(owner, 'patch', `/sales/${sale.id}`, coop)
      .send({ note: 'Tidying up' })
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.sales.notADraft')
  })

  it('confirms at most once per retry key', async () => {
    const coop = await createCooperative('Idempotent Confirm Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)
    const sale = await draft({}, owner, coop, yard)
    const key = randomUUID()

    const first = await as(owner, 'post', `/sales/${sale.id}/confirm`, coop)
      .set(HEADERS.idempotencyKey, key)
      .send({})
      .expect(200)
    const second = await as(owner, 'post', `/sales/${sale.id}/confirm`, coop)
      .set(HEADERS.idempotencyKey, key)
      .send({})
      .expect(200)

    expect(second.body.data.reference).toBe(first.body.data.reference)
    // Pressing Confirm twice must not empty the shelf twice over.
    expect(await levelOf(yard.maize, yard.store)).toBe('900')
    const movements = await prisma.inventoryTransaction.count({ where: { saleId: sale.id } })
    expect(movements).toBe(1)
  })

  it('needs sales:confirm, which a storekeeper does not hold', async () => {
    const sale = await draft()
    // An inventory officer may see sales but not complete one, even though they are the person
    // who would hand the stock over. An accountant holds sales:confirm and a manager holds it.
    await as(storekeeper, 'post', `/sales/${sale.id}/confirm`).send({}).expect(403)
    await as(viewer, 'post', `/sales/${sale.id}/confirm`).send({}).expect(403)
    await as(accountant, 'post', `/sales/${sale.id}/confirm`).send({}).expect(200)
  })
})

describe('a failure part way through confirmation', () => {
  /**
   * The Phase 7 exit criterion, and the reason confirmation is one transaction.
   *
   * Both of these are real failures rather than injected ones. The first fails at the last step,
   * after the stock has already come out and the movements have been written; the second fails on
   * the second line, after the first line's stock has already been decremented.
   */
  it('leaves the sale in draft with no stock moved and no money recorded', async () => {
    const coop = await createCooperative('Rollback Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)
    const sale = await draft({}, owner, coop, yard)

    // A payment against a category that does not exist. Everything before it has already
    // happened inside the transaction: the stock is out and the movement is written.
    const response = await as(owner, 'post', `/sales/${sale.id}/confirm`, coop)
      .send({
        amountPaid: '45000',
        method: 'CASH',
        incomeCategoryId: '00000000-0000-4000-8000-000000000000',
      })
      .expect(422)
    expect(response.body.error.details[0].field).toBe('body.categoryId')

    const after = await as(owner, 'get', `/sales/${sale.id}`, coop).expect(200)
    expect(after.body.data.status).toBe('DRAFT')
    expect(after.body.data.confirmedAt).toBeNull()
    expect(after.body.data.amountPaid).toBe('0.00')

    expect(await levelOf(yard.maize, yard.store)).toBe('1000')
    expect(await prisma.inventoryTransaction.count({ where: { saleId: sale.id } })).toBe(0)
    expect(await prisma.financeTransaction.count({ where: { saleId: sale.id } })).toBe(0)

    // And the movement history still adds up to the levels, which is what proves nothing was
    // half-written.
    const rebuild = await rebuildStockLevels(coop.id)
    expect(rebuild.agrees).toBe(true)
  })

  it('undoes the first line when the second line is short', async () => {
    const coop = await createCooperative('Second Line Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)

    const units = await as(owner, 'get', '/units', coop).expect(200)
    const unitId = (units.body.data as { key: string; id: string }[]).find(
      (row) => row.key === 'KG',
    )?.id as string
    const scarce = await as(owner, 'post', '/products', coop)
      .send({ name: 'Almost none left', unitId })
      .expect(201)
    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId: scarce.body.data.id, warehouseId: yard.store, quantity: '2' })
      .expect(201)

    const sale = await draft(
      {
        lines: [
          { productId: yard.maize, quantity: '100', unitPrice: '450' },
          { productId: scarce.body.data.id, quantity: '50', unitPrice: '100' },
        ],
      },
      owner,
      coop,
      yard,
    )

    await as(owner, 'post', `/sales/${sale.id}/confirm`, coop).send({}).expect(409)

    // The first line's decrement must not survive the second line failing.
    expect(await levelOf(yard.maize, yard.store)).toBe('1000')
    expect(await levelOf(scarce.body.data.id as string, yard.store)).toBe('2')
    expect(await prisma.inventoryTransaction.count({ where: { saleId: sale.id } })).toBe(0)

    const rebuild = await rebuildStockLevels(coop.id)
    expect(rebuild.agrees).toBe(true)
  })
})

describe('cancelling', () => {
  it('puts the stock back with compensating movements rather than deleting anything', async () => {
    const coop = await createCooperative('Cancel Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)
    const sale = await draft({}, owner, coop, yard)

    await as(owner, 'post', `/sales/${sale.id}/confirm`, coop)
      .send({ amountPaid: '45000', method: 'CASH', incomeCategoryId: yard.incomeCategory })
      .expect(200)
    expect(await levelOf(yard.maize, yard.store)).toBe('900')

    const response = await as(owner, 'post', `/sales/${sale.id}/cancel`, coop)
      .send({ reason: 'Buyer rejected the quality' })
      .expect(200)

    expect(response.body.data.status).toBe('CANCELLED')
    expect(response.body.data.cancelReason).toBe('Buyer rejected the quality')
    expect(response.body.data.amountPaid).toBe('0.00')
    expect(response.body.data.paymentStatus).toBe('UNPAID')

    // Back where it started, and by a movement rather than by removing the first one.
    expect(await levelOf(yard.maize, yard.store)).toBe('1000')

    const movements = await prisma.inventoryTransaction.findMany({
      where: { saleId: sale.id },
      select: { type: true, direction: true, reason: true },
      orderBy: { createdAt: 'asc' },
    })
    expect(movements.map((row) => row.type)).toEqual(['SALE_OUT', 'SALE_RETURN'])
    expect(movements[1]?.direction).toBe('IN')
    expect(movements[1]?.reason).toBe('Buyer rejected the quality')

    // The income is reversed the way the finance module reverses anything.
    const ledger = await as(owner, 'get', '/finance/transactions?pageSize=1', coop).expect(200)
    expect(ledger.body.meta.totals.income).toBe('0.00')

    const voided = await prisma.financeTransaction.findFirst({
      where: { saleId: sale.id, status: 'VOID' },
      select: { voidReason: true },
    })
    expect(voided?.voidReason).toContain('Buyer rejected the quality')

    const rebuild = await rebuildStockLevels(coop.id)
    expect(rebuild.agrees).toBe(true)
  })

  it('says a cancelled sale owes nothing, while keeping what it was worth', async () => {
    const coop = await createCooperative('Cancelled Owes Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)
    const sale = await draft({}, owner, coop, yard)
    await as(owner, 'post', `/sales/${sale.id}/confirm`, coop).send({}).expect(200)

    const cancelled = await as(owner, 'post', `/sales/${sale.id}/cancel`, coop)
      .send({ reason: 'Buyer withdrew' })
      .expect(200)

    // The total stays, because that is what the sale was worth and a report covering the period
    // has to say so. The outstanding figure is nil, because a treasurer scanning that column
    // must not be sent to chase a buyer for business that was undone.
    expect(cancelled.body.data.total).toBe('45000.00')
    expect(cancelled.body.data.outstanding).toBe('0.00')

    const profile = await as(owner, 'get', `/buyers/${yard.buyer}`, coop).expect(200)
    expect(profile.body.data.saleCount).toBe(0)
    expect(profile.body.data.outstanding).toBe('0.00')
  })

  it('cancels a draft without compensating for anything', async () => {
    const coop = await createCooperative('Cancel Draft Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)
    const sale = await draft({}, owner, coop, yard)

    await as(owner, 'post', `/sales/${sale.id}/cancel`, coop)
      .send({ reason: 'Written up by mistake' })
      .expect(200)

    // Nothing ever left, so there is nothing to put back.
    expect(await prisma.inventoryTransaction.count({ where: { saleId: sale.id } })).toBe(0)
    expect(await levelOf(yard.maize, yard.store)).toBe('1000')
  })

  it('refuses a cancellation with no reason, and a second cancellation', async () => {
    const coop = await createCooperative('Reason Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)
    const sale = await draft({}, owner, coop, yard)

    // A cancelled sale that cannot be explained is one nobody can audit.
    await as(owner, 'post', `/sales/${sale.id}/cancel`, coop).send({}).expect(422)
    await as(owner, 'post', `/sales/${sale.id}/cancel`, coop).send({ reason: '  ' }).expect(422)

    await as(owner, 'post', `/sales/${sale.id}/cancel`, coop).send({ reason: 'Once' }).expect(200)
    const again = await as(owner, 'post', `/sales/${sale.id}/cancel`, coop)
      .send({ reason: 'Twice' })
      .expect(409)
    expect(again.body.error.messageKey).toBe('errors.sales.alreadyCancelled')
  })

  it('needs sales:cancel, which an accountant does not hold', async () => {
    const sale = await draft()
    await as(accountant, 'post', `/sales/${sale.id}/cancel`).send({ reason: 'No' }).expect(403)
  })
})

describe('payment after the fact', () => {
  it('records money received and keeps the sale figure in step with the books', async () => {
    const coop = await createCooperative('Later Payment Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)
    const sale = await draft({}, owner, coop, yard)
    await as(owner, 'post', `/sales/${sale.id}/confirm`, coop).send({}).expect(200)

    const first = await as(owner, 'post', `/sales/${sale.id}/payments`, coop)
      .send({ amount: '20000', method: 'MOBILE_MONEY', incomeCategoryId: yard.incomeCategory })
      .expect(201)
    expect(first.body.data.paymentStatus).toBe('PARTIAL')
    expect(first.body.data.amountPaid).toBe('20000.00')

    const second = await as(owner, 'post', `/sales/${sale.id}/payments`, coop)
      .send({ amount: '25000', method: 'CASH', incomeCategoryId: yard.incomeCategory })
      .expect(201)
    expect(second.body.data.paymentStatus).toBe('PAID')
    expect(second.body.data.amountPaid).toBe('45000.00')
    expect(second.body.data.outstanding).toBe('0.00')
    expect(second.body.data.payments).toHaveLength(2)
  })

  it('refuses more than is still owed', async () => {
    const coop = await createCooperative('Overpay Later Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)
    const sale = await draft({}, owner, coop, yard)
    await as(owner, 'post', `/sales/${sale.id}/confirm`, coop)
      .send({ amountPaid: '40000', method: 'CASH', incomeCategoryId: yard.incomeCategory })
      .expect(200)

    // Overpaying is a slip rather than a payment, and accepting it would show more received than
    // the sale was ever worth.
    await as(owner, 'post', `/sales/${sale.id}/payments`, coop)
      .send({ amount: '10000', method: 'CASH', incomeCategoryId: yard.incomeCategory })
      .expect(422)
  })

  it('refuses payment against a draft', async () => {
    const sale = await draft()
    const response = await as(manager, 'post', `/sales/${sale.id}/payments`)
      .send({ amount: '100', method: 'CASH', incomeCategoryId: incomeCategory })
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.sales.paymentNeedsConfirmed')
  })

  it('needs finance:create, because it writes into the books', async () => {
    const coop = await createCooperative('Payment Permission Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const keeper = await createStaffSession(app, coop, 'INVENTORY_OFFICER')
    const yard = await setUpYard(coop, owner)
    const sale = await draft({}, owner, coop, yard)
    await as(owner, 'post', `/sales/${sale.id}/confirm`, coop).send({}).expect(200)

    // A storekeeper holds no finance permission at all.
    await as(keeper, 'post', `/sales/${sale.id}/payments`, coop)
      .send({ amount: '100', method: 'CASH', incomeCategoryId: yard.incomeCategory })
      .expect(403)
  })
})

describe('the sales list', () => {
  it('totals confirmed sales only, across the whole filter', async () => {
    const coop = await createCooperative('List Totals Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)

    const confirmed = await draft({}, owner, coop, yard)
    await as(owner, 'post', `/sales/${confirmed.id}/confirm`, coop)
      .send({ amountPaid: '20000', method: 'CASH', incomeCategoryId: yard.incomeCategory })
      .expect(200)
    await draft({}, owner, coop, yard)
    const cancelled = await draft({}, owner, coop, yard)
    await as(owner, 'post', `/sales/${cancelled.id}/cancel`, coop)
      .send({ reason: 'Not going ahead' })
      .expect(200)

    const response = await as(owner, 'get', '/sales', coop).expect(200)
    // Three sales on screen; one of them is business the cooperative actually did.
    expect(response.body.meta.total).toBe(3)
    expect(response.body.meta.totals.sold).toBe('45000.00')
    expect(response.body.meta.totals.paid).toBe('20000.00')
    expect(response.body.meta.totals.outstanding).toBe('25000.00')
  })

  it('filters by status, payment status, buyer and date', async () => {
    const checks: [string, (row: Record<string, unknown>) => boolean][] = [
      ['status=DRAFT', (row) => row.status === 'DRAFT'],
      ['paymentStatus=UNPAID', (row) => row.paymentStatus === 'UNPAID'],
      [`buyerId=${buyer}`, (row) => row.buyerId === buyer],
    ]
    for (const [query, holds] of checks) {
      const response = await as(manager, 'get', `/sales?${query}`).expect(200)
      expect(
        (response.body.data as Record<string, unknown>[]).every(holds),
        `filter ${query}`,
      ).toBe(true)
    }
  })

  it('searches the reference and the buyer name', async () => {
    const sale = await draft()
    for (const query of [sale.reference, 'District']) {
      const response = await as(manager, 'get', `/sales?q=${encodeURIComponent(query)}`).expect(200)
      expect(response.body.meta.total, `searching ${query}`).toBeGreaterThan(0)
    }
  })

  it('refuses an unknown filter and an unknown sort', async () => {
    await as(manager, 'get', '/sales?statuss=DRAFT').expect(422)
    await as(manager, 'get', '/sales?sort=createdById').expect(422)
  })
})

describe('the sales summary', () => {
  it('reports what was sold, to whom, and of what', async () => {
    const coop = await createCooperative('Sales Summary Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)

    for (const [date, quantity] of [
      ['2026-01-10', '100'],
      ['2026-01-20', '150'],
      ['2026-03-05', '200'],
    ] as const) {
      const sale = await as(owner, 'post', '/sales', coop)
        .send({
          buyerId: yard.buyer,
          warehouseId: yard.store,
          saleDate: date,
          lines: [{ productId: yard.maize, quantity, unitPrice: '450' }],
        })
        .expect(201)
      await as(owner, 'post', `/sales/${sale.body.data.id as string}/confirm`, coop)
        .send({})
        .expect(200)
    }

    const response = await as(
      owner,
      'get',
      '/sales/summary?from=2026-01-01&to=2026-03-31&groupBy=month',
      coop,
    ).expect(200)
    const data = response.body.data

    expect(data.saleCount).toBe(3)
    expect(data.sold).toBe('202500.00')
    // February had no sales, and appears as zero rather than being omitted.
    expect((data.buckets as { start: string; sold: string }[]).map((row) => row.start)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ])
    expect((data.buckets as { sold: string }[])[1]?.sold).toBe('0.00')

    expect((data.topBuyers as { name: string; sold: string }[])[0]?.sold).toBe('202500.00')
    const product = (data.topProducts as { sku: string; quantity: string; sold: string }[])[0]
    expect(product?.quantity).toBe('450.000')
    expect(product?.sold).toBe('202500.00')
  })

  it('requires both ends of the range', async () => {
    await as(manager, 'get', '/sales/summary').expect(422)
    await as(manager, 'get', '/sales/summary?from=2026-01-01').expect(422)
  })

  it('is not read as a sale whose identifier is the word summary', async () => {
    // The fixed path is registered before the parameterised one.
    await as(manager, 'get', '/sales/summary?from=2026-01-01&to=2026-12-31').expect(200)
  })
})

describe('the receipt', () => {
  it('carries everything a printed receipt needs, already totalled', async () => {
    const coop = await createCooperative('Receipt Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)
    const sale = await draft({}, owner, coop, yard)
    await as(owner, 'post', `/sales/${sale.id}/confirm`, coop)
      .send({ amountPaid: '45000', method: 'CASH', incomeCategoryId: yard.incomeCategory })
      .expect(200)

    const response = await as(owner, 'get', `/sales/${sale.id}/receipt`, coop).expect(200)
    const receipt = response.body.data

    expect(receipt.cooperative.name).toBe('Receipt Cooperative')
    expect(receipt.buyer.name).toBe('District buyer')
    expect(receipt.sale.total).toBe('45000.00')
    expect(receipt.sale.lines).toHaveLength(1)
    expect(receipt.sale.payments).toHaveLength(1)
    // Two copies of the same sale can be told apart.
    expect(receipt.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(receipt.issuedBy).toBeTruthy()

    // Nothing in the printing path can arrive at a different total from the books: every figure
    // is already a rounded string.
    expect(typeof receipt.sale.total).toBe('string')
    expect(typeof receipt.sale.lines[0].lineTotal).toBe('string')
  })

  it('records who took a copy', async () => {
    const sale = await draft()
    await as(manager, 'get', `/sales/${sale.id}/receipt`).expect(200)
    const log = await prisma.auditLog.findFirst({
      where: { entityId: sale.id, action: 'sales.receipt.issued' },
    })
    expect(log).not.toBeNull()
  })
})

describe('what a sale leaves in the other modules', () => {
  it('shows the stock movement in the inventory history', async () => {
    const coop = await createCooperative('Joined Up Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)
    const sale = await draft({}, owner, coop, yard)
    await as(owner, 'post', `/sales/${sale.id}/confirm`, coop).send({}).expect(200)

    const movements = await as(owner, 'get', '/inventory/transactions?type=SALE_OUT', coop).expect(
      200,
    )
    expect(movements.body.meta.total).toBe(1)
    expect((movements.body.data as { quantity: string }[])[0]?.quantity).toBe('100.000')
  })

  it('shows the payment in the finance ledger, marked as coming from a sale', async () => {
    const coop = await createCooperative('Joined Books Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)
    const sale = await draft({}, owner, coop, yard)
    await as(owner, 'post', `/sales/${sale.id}/confirm`, coop)
      .send({ amountPaid: '45000', method: 'CASH', incomeCategoryId: yard.incomeCategory })
      .expect(200)

    const ledger = await as(owner, 'get', '/finance/transactions', coop).expect(200)
    const row = (ledger.body.data as { sourceType: string; amount: string }[])[0]
    expect(row?.sourceType).toBe('SALE')
    expect(row?.amount).toBe('45000.00')
    expect(ledger.body.meta.totals.income).toBe('45000.00')
  })

  it('refuses to void a sale payment from the finance ledger', async () => {
    const coop = await createCooperative('Sale Void Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const yard = await setUpYard(coop, owner)
    const sale = await draft({}, owner, coop, yard)
    await as(owner, 'post', `/sales/${sale.id}/confirm`, coop)
      .send({ amountPaid: '45000', method: 'CASH', incomeCategoryId: yard.incomeCategory })
      .expect(200)

    const entry = await prisma.financeTransaction.findFirstOrThrow({
      where: { saleId: sale.id },
      select: { id: true },
    })

    // The ledger row and the sale are two views of the same money. Voiding only the ledger side
    // would leave the sale claiming a payment the books no longer hold.
    const response = await as(owner, 'post', `/finance/transactions/${entry.id}/void`, coop)
      .send({})
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.finance.voidFromSource')
  })
})
