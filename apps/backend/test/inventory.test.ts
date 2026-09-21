import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HEADERS } from '@coopmanage/shared'
import { API_PREFIX } from '../src/app.js'
import { disconnectPrisma, prisma } from '../src/lib/prisma.js'
import { rebuildStockLevels } from '../src/modules/inventory/rebuild.js'
import { scanLowStock } from '../src/modules/inventory/lowStock.js'
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
let storekeeper: TestUser & Session & { staffId: string }
let accountant: TestUser & Session & { staffId: string }
let viewer: TestUser & Session & { staffId: string }

let kilogram: string
let store: string
let secondStore: string
let maize: string

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

/** A cooperative with a unit, a store and a product, which is the least a movement needs. */
async function setUpStore(
  coop: TestCooperative,
  owner: Session,
): Promise<{ unitId: string; warehouseId: string; productId: string }> {
  const unit = await as(owner, 'get', '/units', coop).expect(200)
  const unitId = (unit.body.data as { key: string; id: string }[]).find((row) => row.key === 'KG')
    ?.id as string

  const warehouse = await as(owner, 'post', '/warehouses', coop)
    .send({ name: 'Main store' })
    .expect(201)

  const product = await as(owner, 'post', '/products', coop)
    .send({ name: 'Maize grain', nameRw: 'Ibigori', unitId, minStockLevel: '50' })
    .expect(201)

  return {
    unitId,
    warehouseId: warehouse.body.data.id as string,
    productId: product.body.data.id as string,
  }
}

beforeAll(async () => {
  cooperative = await createCooperative('Inventory Test Cooperative')
  manager = await createStaffSession(app, cooperative, 'MANAGER')
  storekeeper = await createStaffSession(app, cooperative, 'INVENTORY_OFFICER')
  accountant = await createStaffSession(app, cooperative, 'ACCOUNTANT')
  viewer = await createStaffSession(app, cooperative, 'VIEWER')

  const setUp = await setUpStore(cooperative, manager)
  kilogram = setUp.unitId
  store = setUp.warehouseId
  maize = setUp.productId

  const second = await as(manager, 'post', '/warehouses')
    .send({ name: 'Kinigi collection point' })
    .expect(201)
  secondStore = second.body.data.id as string
}, 90_000)

afterAll(async () => {
  await cleanupFixtures()
  await disconnectPrisma()
})

describe('the catalogue', () => {
  it('offers the units the platform seeded without a cooperative defining them first', async () => {
    const response = await as(manager, 'get', '/units').expect(200)
    const keys = (response.body.data as { key: string; isSystem: boolean }[])
      .filter((row) => row.isSystem)
      .map((row) => row.key)

    // Nothing in the system assumes kilograms, but a cooperative should not have to define them
    // before recording its first delivery.
    expect(keys).toContain('KG')
    expect(keys).toContain('SACK')
    expect(keys.length).toBeGreaterThan(5)
  })

  it('lets a cooperative add its own unit and refuses a duplicate key', async () => {
    const created = await as(manager, 'post', '/units')
      .send({
        key: 'BASKET',
        nameEn: 'Basket',
        nameRw: 'Igitebo',
        symbol: 'basket',
        precision: 0,
      })
      .expect(201)
    expect(created.body.data.isSystem).toBe(false)

    const duplicate = await as(manager, 'post', '/units')
      .send({ key: 'BASKET', nameEn: 'Basket', nameRw: 'Igitebo', symbol: 'basket' })
      .expect(409)
    expect(duplicate.body.error.messageKey).toBe('errors.catalogue.unitKeyTaken')
  })

  it('refuses to rename a unit the whole platform shares', async () => {
    // Renaming this one would change what a kilogram is called for every other cooperative.
    const response = await as(manager, 'patch', `/units/${kilogram}`)
      .send({ nameEn: 'Kilos' })
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.catalogue.systemUnit')
  })

  it('builds a product code from its name when the cooperative has none', async () => {
    const created = await as(manager, 'post', '/products')
      .send({ name: 'Bean seed', unitId: kilogram })
      .expect(201)
    // It ends up on a paper label, so it reads rather than being random.
    expect(created.body.data.sku).toBe('BEAN-SEED')

    const second = await as(manager, 'post', '/products')
      .send({ name: 'Bean seed', unitId: kilogram })
      .expect(201)
    expect(second.body.data.sku).toBe('BEAN-SEED-2')
  })

  it('refuses a stock minimum on something nobody counts', async () => {
    await as(manager, 'post', '/products')
      .send({
        name: 'Tractor hire',
        unitId: kilogram,
        type: 'SERVICE',
        trackInventory: false,
        minStockLevel: '5',
      })
      .expect(422)
  })

  it('refuses a service that claims to be counted', async () => {
    await as(manager, 'post', '/products')
      .send({ name: 'Ploughing', unitId: kilogram, type: 'SERVICE', trackInventory: true })
      .expect(422)
  })

  it('freezes the unit once movements exist against a product', async () => {
    const sack = await as(manager, 'get', '/units').expect(200)
    const sackId = (sack.body.data as { key: string; id: string }[]).find(
      (row) => row.key === 'SACK',
    )?.id as string

    const product = await as(manager, 'post', '/products')
      .send({ name: 'Frozen unit product', unitId: kilogram })
      .expect(201)
    const productId = product.body.data.id as string

    // Before any movement the unit is still a decision.
    await as(manager, 'patch', `/products/${productId}`).send({ unitId: sackId }).expect(200)

    await as(storekeeper, 'post', '/inventory/receive')
      .send({ productId, warehouseId: store, quantity: '10' })
      .expect(201)

    // After one, changing it would turn three hundred kilograms into three hundred sacks.
    const refused = await as(manager, 'patch', `/products/${productId}`)
      .send({ unitId: kilogram })
      .expect(409)
    expect(refused.body.error.messageKey).toBe('errors.catalogue.unitFrozen')
  })

  it('freezes whether a product is counted once movements exist', async () => {
    const product = await as(manager, 'post', '/products')
      .send({ name: 'Counted for good', unitId: kilogram })
      .expect(201)
    const productId = product.body.data.id as string
    await as(storekeeper, 'post', '/inventory/receive')
      .send({ productId, warehouseId: store, quantity: '5' })
      .expect(201)

    // Switching it off would abandon the stock level with no movement explaining where it went.
    await as(manager, 'patch', `/products/${productId}`).send({ trackInventory: false }).expect(409)
  })

  it('has no delete route for a product, and retires it instead', async () => {
    const product = await as(manager, 'post', '/products')
      .send({ name: 'To be retired', unitId: kilogram })
      .expect(201)
    const productId = product.body.data.id as string

    const response = await request(app)
      .delete(`${API_PREFIX}/products/${productId}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set(HEADERS.cooperativeId, cooperative.id)
    expect(response.status).toBe(404)

    await as(manager, 'patch', `/products/${productId}`).send({ isActive: false }).expect(200)
    const still = await prisma.product.findUnique({ where: { id: productId } })
    expect(still).not.toBeNull()
  })

  it('refuses to record stock against a retired product', async () => {
    const product = await as(manager, 'post', '/products')
      .send({ name: 'Already retired', unitId: kilogram })
      .expect(201)
    const productId = product.body.data.id as string
    await as(manager, 'patch', `/products/${productId}`).send({ isActive: false }).expect(200)

    const response = await as(storekeeper, 'post', '/inventory/receive')
      .send({ productId, warehouseId: store, quantity: '10' })
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.inventory.productRetired')
  })

  it('refuses to move stock of something that is not counted', async () => {
    const service = await as(manager, 'post', '/products')
      .send({ name: 'Transport service', unitId: kilogram, type: 'SERVICE', trackInventory: false })
      .expect(201)

    const response = await as(storekeeper, 'post', '/inventory/receive')
      .send({ productId: service.body.data.id, warehouseId: store, quantity: '1' })
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.inventory.productNotCounted')
  })

  it('lets the storekeeper manage the catalogue, and a viewer only read it', async () => {
    // The inventory officer is the person who keeps the catalogue, so they hold products:manage.
    await as(storekeeper, 'post', '/products')
      .send({ name: 'Added by the storekeeper', unitId: kilogram })
      .expect(201)

    await as(viewer, 'get', '/products').expect(200)
    await as(viewer, 'post', '/products')
      .send({ name: 'Not allowed', unitId: kilogram })
      .expect(403)
  })

  it('lets a cooperative rename and retire a unit of its own', async () => {
    const created = await as(manager, 'post', '/units')
      .send({ key: 'CRATE', nameEn: 'Crate', nameRw: 'Agasanduku', symbol: 'crate', precision: 0 })
      .expect(201)
    const id = created.body.data.id as string

    const renamed = await as(manager, 'patch', `/units/${id}`)
      .send({ nameEn: 'Wooden crate', isActive: false })
      .expect(200)
    expect(renamed.body.data.nameEn).toBe('Wooden crate')
    expect(renamed.body.data.isActive).toBe(false)

    // A retired unit is out of the list a form offers, and still there when asked for.
    const offered = await as(manager, 'get', '/units').expect(200)
    expect((offered.body.data as { id: string }[]).some((row) => row.id === id)).toBe(false)
    const all = await as(manager, 'get', '/units?includeInactive=true').expect(200)
    expect((all.body.data as { id: string }[]).some((row) => row.id === id)).toBe(true)

    // Nothing to change is a mistake, not a no-op.
    await as(manager, 'patch', `/units/${id}`).send({}).expect(422)
  })

  it('keeps product categories as a tree the cooperative shapes itself', async () => {
    const parent = await as(manager, 'post', '/product-categories')
      .send({ name: 'Grains', nameRw: 'Ibinyampeke' })
      .expect(201)
    const child = await as(manager, 'post', '/product-categories')
      .send({ name: 'Cereals', parentId: parent.body.data.id })
      .expect(201)

    const listed = await as(viewer, 'get', '/product-categories').expect(200)
    const rows = listed.body.data as { id: string; name: string; parentId: string | null }[]
    expect(rows.find((row) => row.id === child.body.data.id)?.parentId).toBe(parent.body.data.id)

    const renamed = await as(storekeeper, 'patch', `/product-categories/${child.body.data.id}`)
      .send({ name: 'Cereal grains', isActive: false })
      .expect(200)
    expect(renamed.body.data.name).toBe('Cereal grains')
    expect(renamed.body.data.isActive).toBe(false)

    // Retired categories are out of the default list and back with the flag.
    const active = await as(viewer, 'get', '/product-categories').expect(200)
    expect(
      (active.body.data as { id: string }[]).some((row) => row.id === child.body.data.id),
    ).toBe(false)
    const everything = await as(viewer, 'get', '/product-categories?includeInactive=true').expect(
      200,
    )
    expect(
      (everything.body.data as { id: string }[]).some((row) => row.id === child.body.data.id),
    ).toBe(true)

    await as(viewer, 'patch', `/product-categories/${child.body.data.id}`)
      .send({ name: 'Not allowed' })
      .expect(403)
  })

  it('refuses a code already on the label of something else, by name', async () => {
    // Somebody's own product code, category name or store code is taken exactly once. The second
    // attempt is a 409 that names the field, not a bare constraint error from the database.
    await as(manager, 'post', '/products')
      .send({ name: 'Coffee cherry', sku: 'CHERRY-A', unitId: kilogram })
      .expect(201)
    const sku = await as(manager, 'post', '/products')
      .send({ name: 'Coffee cherry, grade A', sku: 'cherry-a', unitId: kilogram })
      .expect(409)
    expect(sku.body.error.messageKey).toBe('errors.catalogue.skuTaken')

    const second = await as(manager, 'post', '/products')
      .send({ name: 'Coffee cherry, grade B', sku: 'CHERRY-B', unitId: kilogram })
      .expect(201)
    const renamed = await as(manager, 'patch', `/products/${second.body.data.id as string}`)
      .send({ sku: 'CHERRY-A' })
      .expect(409)
    expect(renamed.body.error.messageKey).toBe('errors.catalogue.skuTaken')

    await as(manager, 'post', '/product-categories').send({ name: 'Pulses' }).expect(201)
    const category = await as(manager, 'post', '/product-categories')
      .send({ name: 'Pulses' })
      .expect(409)
    expect(category.body.error.messageKey).toBe('errors.catalogue.categoryNameTaken')
    const other = await as(manager, 'post', '/product-categories')
      .send({ name: 'Tubers' })
      .expect(201)
    const categoryRenamed = await as(
      manager,
      'patch',
      `/product-categories/${other.body.data.id as string}`,
    )
      .send({ name: 'Pulses' })
      .expect(409)
    expect(categoryRenamed.body.error.messageKey).toBe('errors.catalogue.categoryNameTaken')

    await as(manager, 'post', '/warehouses')
      .send({ name: 'Drying shed', code: 'SHED-1' })
      .expect(201)
    const store = await as(manager, 'post', '/warehouses')
      .send({ name: 'Second shed', code: 'SHED-1' })
      .expect(409)
    expect(store.body.error.messageKey).toBe('errors.catalogue.warehouseCodeTaken')
    const shed = await as(manager, 'post', '/warehouses')
      .send({ name: 'Third shed', code: 'SHED-3' })
      .expect(201)
    const storeRenamed = await as(manager, 'patch', `/warehouses/${shed.body.data.id as string}`)
      .send({ code: 'SHED-1' })
      .expect(409)
    expect(storeRenamed.body.error.messageKey).toBe('errors.catalogue.warehouseCodeTaken')
  })

  it('answers a single product with the same shape as the list', async () => {
    const one = await as(viewer, 'get', `/products/${maize}`).expect(200)
    expect(one.body.data.id).toBe(maize)
    expect(one.body.data.name).toBe('Maize grain')
    expect(one.body.data.unitSymbol).toBe('kg')
    expect(one.body.data.trackInventory).toBe(true)

    const listed = await as(viewer, 'get', '/products').expect(200)
    const fromList = (listed.body.data as { id: string }[]).find((row) => row.id === maize)
    expect(Object.keys(fromList ?? {}).sort()).toEqual(Object.keys(one.body.data).sort())

    await as(viewer, 'get', '/products/00000000-0000-4000-8000-000000000000').expect(404)
  })
})

describe('stores', () => {
  it('makes the first store the default whatever was asked for', async () => {
    const coop = await createCooperative('First Store Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')

    const created = await as(owner, 'post', '/warehouses', coop)
      .send({ name: 'The only store', isDefault: false })
      .expect(201)

    // A movement has to say where it happened, so there is always somewhere to put stock.
    expect(created.body.data.isDefault).toBe(true)
  })

  it('keeps exactly one default, moving the flag rather than setting it', async () => {
    const promoted = await as(manager, 'patch', `/warehouses/${secondStore}`)
      .send({ isDefault: true })
      .expect(200)
    expect(promoted.body.data.isDefault).toBe(true)

    const all = await as(manager, 'get', '/warehouses').expect(200)
    const defaults = (all.body.data as { isDefault: boolean }[]).filter((row) => row.isDefault)
    expect(defaults).toHaveLength(1)

    await as(manager, 'patch', `/warehouses/${store}`).send({ isDefault: true }).expect(200)
  })

  it('refuses to leave a cooperative with no default store', async () => {
    const response = await as(manager, 'patch', `/warehouses/${store}`)
      .send({ isDefault: false })
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.catalogue.warehouseIsDefault')
  })

  it('refuses to close a store that still holds stock', async () => {
    const product = await as(manager, 'post', '/products')
      .send({ name: 'Left in the store', unitId: kilogram })
      .expect(201)
    await as(storekeeper, 'post', '/inventory/receive')
      .send({ productId: product.body.data.id, warehouseId: secondStore, quantity: '25' })
      .expect(201)

    // The stock would still be there with no screen showing it.
    const response = await as(manager, 'patch', `/warehouses/${secondStore}`)
      .send({ isActive: false })
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.catalogue.warehouseHoldsStock')

    await as(storekeeper, 'post', '/inventory/issue')
      .send({ productId: product.body.data.id, warehouseId: secondStore, quantity: '25' })
      .expect(201)
  })
})

describe('receiving stock', () => {
  it('records the movement and moves the level in one act', async () => {
    const response = await as(storekeeper, 'post', '/inventory/receive')
      .send({ productId: maize, warehouseId: store, quantity: '400.500' })
      .expect(201)

    expect(response.body.data.reference).toMatch(/^STK-\d{4}-\d{6}$/)
    expect(response.body.data.quantity).toBe('400.500')
    expect(response.body.data.quantityAfter).toBe('400.500')

    const level = await prisma.stockLevel.findUniqueOrThrow({
      where: { productId_warehouseId: { productId: maize, warehouseId: store } },
      select: { quantity: true },
    })
    // Three decimal places, because a cooperative weighs to the gram.
    expect(level.quantity.toString()).toBe('400.5')
  })

  it('rejects a quantity with more decimal places than the column holds', async () => {
    await as(storekeeper, 'post', '/inventory/receive')
      .send({ productId: maize, warehouseId: store, quantity: '10.0005' })
      .expect(422)
  })

  it('rejects a quantity of nothing, and of less than nothing', async () => {
    for (const quantity of ['0', '-10', 'ten sacks', '']) {
      await as(storekeeper, 'post', '/inventory/receive')
        .send({ productId: maize, warehouseId: store, quantity })
        .expect(422)
    }
  })

  it('names the member who delivered it, which is what a profile sums over', async () => {
    const member = await prisma.member.create({
      data: {
        cooperativeId: cooperative.id,
        memberCode: 'INV-00001',
        firstName: 'Delivers',
        lastName: 'Maize',
        joinedOn: new Date('2026-01-01T00:00:00.000Z'),
      },
      select: { id: true },
    })

    await as(storekeeper, 'post', '/inventory/receive')
      .send({
        productId: maize,
        warehouseId: store,
        quantity: '120',
        sourceMemberId: member.id,
      })
      .expect(201)

    // No separate deliveries table, so the store record and the member's history cannot disagree.
    const delivered = await prisma.inventoryTransaction.aggregate({
      where: { cooperativeId: cooperative.id, sourceMemberId: member.id, type: 'RECEIPT' },
      _sum: { quantity: true },
    })
    expect(delivered._sum.quantity?.toString()).toBe('120')
  })

  it('refuses a member belonging to another cooperative', async () => {
    const other = await createCooperative('Foreign Delivery Cooperative')
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

    await as(storekeeper, 'post', '/inventory/receive')
      .send({ productId: maize, warehouseId: store, quantity: '10', sourceMemberId: foreign.id })
      .expect(422)
  })

  it('posts the expense in the same transaction when the cooperative paid on receipt', async () => {
    const category = await prisma.financeCategory.create({
      data: { cooperativeId: cooperative.id, kind: 'EXPENSE', name: 'Stock purchases' },
      select: { id: true },
    })

    const response = await as(storekeeper, 'post', '/inventory/receive')
      .send({
        productId: maize,
        warehouseId: store,
        quantity: '100',
        unitCost: '450.00',
        expenseCategoryId: category.id,
        method: 'MOBILE_MONEY',
      })
      .expect(201)

    expect(response.body.data.financeReference).toMatch(/^EX-\d{4}-\d{6}$/)

    const movement = await prisma.inventoryTransaction.findUniqueOrThrow({
      where: { id: response.body.data.id as string },
      select: {
        totalCost: true,
        financeTransaction: { select: { amount: true, sourceType: true } },
      },
    })
    // A hundred at four hundred and fifty, computed with decimal arithmetic.
    expect(movement.totalCost?.toString()).toBe('45000')
    expect(movement.financeTransaction?.amount.toString()).toBe('45000')
    expect(movement.financeTransaction?.sourceType).toBe('STOCK_PURCHASE')
  })

  it('refuses to post an expense without saying what the stock cost', async () => {
    const category = await prisma.financeCategory.findFirstOrThrow({
      where: { cooperativeId: cooperative.id, kind: 'EXPENSE' },
      select: { id: true },
    })
    await as(storekeeper, 'post', '/inventory/receive')
      .send({
        productId: maize,
        warehouseId: store,
        quantity: '10',
        expenseCategoryId: category.id,
      })
      .expect(422)
  })

  it('leaves nothing behind when the expense cannot be posted', async () => {
    const before = await prisma.inventoryTransaction.count({
      where: { cooperativeId: cooperative.id },
    })

    await as(storekeeper, 'post', '/inventory/receive')
      .send({
        productId: maize,
        warehouseId: store,
        quantity: '10',
        unitCost: '100',
        expenseCategoryId: '00000000-0000-4000-8000-000000000000',
      })
      .expect(422)

    // Stock that arrived without its expense would leave the books short with nothing to show why.
    const after = await prisma.inventoryTransaction.count({
      where: { cooperativeId: cooperative.id },
    })
    expect(after).toBe(before)
  })

  it('records a receipt at most once per retry key', async () => {
    const key = crypto.randomUUID()
    const body = { productId: maize, warehouseId: store, quantity: '77', note: `retry ${key}` }

    const first = await as(storekeeper, 'post', '/inventory/receive')
      .set(HEADERS.idempotencyKey, key)
      .send(body)
      .expect(201)
    const second = await as(storekeeper, 'post', '/inventory/receive')
      .set(HEADERS.idempotencyKey, key)
      .send(body)
      .expect(201)

    // Two receipts of the same seventy-seven sacks is a store record corrected by hand.
    expect(second.body.data.reference).toBe(first.body.data.reference)
    const rows = await prisma.inventoryTransaction.count({
      where: { cooperativeId: cooperative.id, note: body.note },
    })
    expect(rows).toBe(1)
  })

  it('lets a storekeeper receive but refuses a viewer', async () => {
    await as(viewer, 'post', '/inventory/receive')
      .send({ productId: maize, warehouseId: store, quantity: '10' })
      .expect(403)
  })
})

describe('issuing stock', () => {
  it('takes stock out and reports what is left', async () => {
    const coop = await createCooperative('Issue Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)

    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '100' })
      .expect(201)

    const response = await as(owner, 'post', '/inventory/issue', coop)
      .send({ productId, warehouseId, quantity: '30', reason: 'Sold at the store' })
      .expect(201)

    expect(response.body.data.direction).toBe('OUT')
    expect(response.body.data.quantityAfter).toBe('70.000')
  })

  it('refuses to take out more than there is', async () => {
    const coop = await createCooperative('Overissue Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)

    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '10' })
      .expect(201)

    const response = await as(owner, 'post', '/inventory/issue', coop)
      .send({ productId, warehouseId, quantity: '10.001' })
      .expect(409)
    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK')

    // Nothing moved and nothing was written.
    const level = await prisma.stockLevel.findUniqueOrThrow({
      where: { productId_warehouseId: { productId, warehouseId } },
      select: { quantity: true },
    })
    expect(level.quantity.toString()).toBe('10')
    const movements = await prisma.inventoryTransaction.count({
      where: { cooperativeId: coop.id, direction: 'OUT' },
    })
    expect(movements).toBe(0)
  })

  it('refuses to take out a product that has never been in that store', async () => {
    const coop = await createCooperative('Never Stocked Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)

    // A missing level is the same answer as a level of nothing.
    const response = await as(owner, 'post', '/inventory/issue', coop)
      .send({ productId, warehouseId, quantity: '1' })
      .expect(409)
    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK')
  })
})

describe('twenty people reaching for ten sacks', () => {
  /**
   * The Phase 6 exit criterion, and the reason `decreaseStock` is a conditional update rather than
   * a check followed by a write.
   */
  it('lets exactly ten through and refuses the other ten, with nothing left over', async () => {
    const coop = await createCooperative('Concurrency Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)

    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '10' })
      .expect(201)

    const attempts = await Promise.all(
      Array.from({ length: 20 }, () =>
        as(owner, 'post', '/inventory/issue', coop).send({
          productId,
          warehouseId,
          quantity: '1',
        }),
      ),
    )

    const succeeded = attempts.filter((res) => res.status === 201)
    const refused = attempts.filter((res) => res.status === 409)

    expect(succeeded).toHaveLength(10)
    expect(refused).toHaveLength(10)
    expect(refused.every((res) => res.body.error.code === 'INSUFFICIENT_STOCK')).toBe(true)

    const level = await prisma.stockLevel.findUniqueOrThrow({
      where: { productId_warehouseId: { productId, warehouseId } },
      select: { quantity: true },
    })
    // Never below nothing, and never a sack issued twice.
    expect(level.quantity.toString()).toBe('0')

    const issued = await prisma.inventoryTransaction.count({
      where: { cooperativeId: coop.id, type: 'ISSUE' },
    })
    expect(issued).toBe(10)
  }, 120_000)
})

describe('correcting a count', () => {
  it('works out the difference from what was counted', async () => {
    const coop = await createCooperative('Adjust Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)

    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '100' })
      .expect(201)

    // The storekeeper counted eight fewer than the record. Asking a person to decide whether that
    // is plus or minus eight is how the wrong sign gets recorded.
    const short = await as(owner, 'post', '/inventory/adjust', coop)
      .send({ productId, warehouseId, countedQuantity: '92', reason: 'Spillage in the store' })
      .expect(201)
    expect(short.body.data.direction).toBe('OUT')
    expect(short.body.data.quantity).toBe('8.000')
    expect(short.body.data.quantityAfter).toBe('92.000')

    const over = await as(owner, 'post', '/inventory/adjust', coop)
      .send({ productId, warehouseId, countedQuantity: '95', reason: 'Found three more sacks' })
      .expect(201)
    expect(over.body.data.direction).toBe('IN')
    expect(over.body.data.quantity).toBe('3.000')
  })

  it('accepts a count of nothing, because an empty shelf is a real answer', async () => {
    const coop = await createCooperative('Empty Shelf Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)

    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '40' })
      .expect(201)
    const response = await as(owner, 'post', '/inventory/adjust', coop)
      .send({ productId, warehouseId, countedQuantity: '0', reason: 'Nothing on the shelf' })
      .expect(201)

    expect(response.body.data.quantityAfter).toBe('0.000')
  })

  it('refuses a correction with no reason', async () => {
    // An unexplained correction is what makes a shortfall unauditable.
    await as(manager, 'post', '/inventory/adjust')
      .send({ productId: maize, warehouseId: store, countedQuantity: '10' })
      .expect(422)
    await as(manager, 'post', '/inventory/adjust')
      .send({ productId: maize, warehouseId: store, countedQuantity: '10', reason: '   ' })
      .expect(422)
  })

  it('says nothing changed rather than writing a movement of nothing', async () => {
    const coop = await createCooperative('Agreeing Count Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)
    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '60' })
      .expect(201)

    const response = await as(owner, 'post', '/inventory/adjust', coop)
      .send({ productId, warehouseId, countedQuantity: '60', reason: 'Counted, all present' })
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.inventory.countAgrees')
  })

  it('needs inventory:adjust, which a storekeeper holds and a viewer does not', async () => {
    await as(viewer, 'post', '/inventory/adjust')
      .send({ productId: maize, warehouseId: store, countedQuantity: '1', reason: 'x' })
      .expect(403)
  })
})

describe('moving stock between stores', () => {
  it('writes both halves, each naming the other', async () => {
    const coop = await createCooperative('Transfer Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)
    const second = await as(owner, 'post', '/warehouses', coop)
      .send({ name: 'Second store' })
      .expect(201)
    const toWarehouse = second.body.data.id as string

    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '200' })
      .expect(201)

    const response = await as(owner, 'post', '/inventory/transfer', coop)
      .send({ productId, fromWarehouseId: warehouseId, toWarehouseId: toWarehouse, quantity: '80' })
      .expect(201)

    expect(response.body.data.out.quantityAfter).toBe('120.000')
    expect(response.body.data.in.quantityAfter).toBe('80.000')

    const outward = await prisma.inventoryTransaction.findUniqueOrThrow({
      where: { id: response.body.data.out.id as string },
      select: { counterpartyTransactionId: true, type: true },
    })
    const inward = await prisma.inventoryTransaction.findUniqueOrThrow({
      where: { id: response.body.data.in.id as string },
      select: { counterpartyTransactionId: true, type: true },
    })
    // Either end of the history names the other, so the stock can always be followed.
    expect(outward.counterpartyTransactionId).toBe(response.body.data.in.id)
    expect(inward.counterpartyTransactionId).toBe(response.body.data.out.id)
    expect(outward.type).toBe('TRANSFER_OUT')
    expect(inward.type).toBe('TRANSFER_IN')
  })

  it('moves nothing at all when there is not enough to move', async () => {
    const coop = await createCooperative('Short Transfer Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)
    const second = await as(owner, 'post', '/warehouses', coop)
      .send({ name: 'Second store' })
      .expect(201)

    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '5' })
      .expect(201)

    await as(owner, 'post', '/inventory/transfer', coop)
      .send({
        productId,
        fromWarehouseId: warehouseId,
        toWarehouseId: second.body.data.id,
        quantity: '10',
      })
      .expect(409)

    // Two transactions would leave a window in which the cooperative owned nothing at all.
    const levels = await prisma.stockLevel.findMany({
      where: { cooperativeId: coop.id },
      select: { warehouseId: true, quantity: true },
    })
    expect(levels).toHaveLength(1)
    expect(levels[0]?.quantity.toString()).toBe('5')
  })

  it('refuses a transfer to the store it came from', async () => {
    await as(manager, 'post', '/inventory/transfer')
      .send({
        productId: maize,
        fromWarehouseId: store,
        toWarehouseId: store,
        quantity: '1',
      })
      .expect(422)
  })
})

describe('reversing a movement', () => {
  it('writes an opposite movement that points at the original', async () => {
    const coop = await createCooperative('Reverse Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)

    const receipt = await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '50' })
      .expect(201)
    const receiptId = receipt.body.data.id as string

    const response = await as(owner, 'post', `/inventory/transactions/${receiptId}/reverse`, coop)
      .send({ reason: 'Recorded against the wrong product' })
      .expect(200)

    const reversal = response.body.data.reversals[0] as { type: string; quantityAfter: string }
    // A row reading "RECEIPT, outward" would be a puzzle for whoever reads the history next year.
    expect(reversal.type).toBe('ISSUE')
    expect(reversal.quantityAfter).toBe('0.000')

    const original = await prisma.inventoryTransaction.findUniqueOrThrow({
      where: { id: receiptId },
      select: { reversedBy: { select: { reference: true, reason: true } } },
    })
    expect(original.reversedBy?.reason).toBe('Recorded against the wrong product')
  })

  it('gives the reversal the original date, so stock does not move between periods', async () => {
    const coop = await createCooperative('Reversal Date Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)

    const receipt = await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '10', occurredAt: '2026-02-10' })
      .expect(201)
    await as(
      owner,
      'post',
      `/inventory/transactions/${receipt.body.data.id as string}/reverse`,
      coop,
    )
      .send({ reason: 'Wrong day' })
      .expect(200)

    const reversal = await prisma.inventoryTransaction.findFirstOrThrow({
      where: { reversalOfId: receipt.body.data.id as string },
      select: { occurredAt: true },
    })
    expect(reversal.occurredAt.toISOString().slice(0, 10)).toBe('2026-02-10')
  })

  it('undoes both halves of a transfer together', async () => {
    const coop = await createCooperative('Reverse Transfer Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)
    const second = await as(owner, 'post', '/warehouses', coop)
      .send({ name: 'Second store' })
      .expect(201)

    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '100' })
      .expect(201)
    const transfer = await as(owner, 'post', '/inventory/transfer', coop)
      .send({
        productId,
        fromWarehouseId: warehouseId,
        toWarehouseId: second.body.data.id,
        quantity: '40',
      })
      .expect(201)

    const response = await as(
      owner,
      'post',
      `/inventory/transactions/${transfer.body.data.out.id as string}/reverse`,
      coop,
    )
      .send({ reason: 'Moved by mistake' })
      .expect(200)

    // Undoing one half would leave the stock in a store it never reached.
    expect(response.body.data.reversals).toHaveLength(2)

    const levels = await prisma.stockLevel.findMany({
      where: { cooperativeId: coop.id },
      select: { warehouseId: true, quantity: true },
    })
    const byStore = new Map(levels.map((row) => [row.warehouseId, row.quantity.toString()]))
    expect(byStore.get(warehouseId)).toBe('100')
    expect(byStore.get(second.body.data.id as string)).toBe('0')
  })

  it('voids the expense a receipt posted', async () => {
    const coop = await createCooperative('Reverse Expense Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)
    const category = await prisma.financeCategory.create({
      data: { cooperativeId: coop.id, kind: 'EXPENSE', name: 'Stock purchases' },
      select: { id: true },
    })

    const receipt = await as(owner, 'post', '/inventory/receive', coop)
      .send({
        productId,
        warehouseId,
        quantity: '20',
        unitCost: '500',
        expenseCategoryId: category.id,
      })
      .expect(201)

    const before = await as(owner, 'get', '/finance/transactions?pageSize=1', coop).expect(200)
    expect(before.body.meta.totals.expenses).toBe('10000.00')

    await as(
      owner,
      'post',
      `/inventory/transactions/${receipt.body.data.id as string}/reverse`,
      coop,
    )
      .send({ reason: 'Never arrived' })
      .expect(200)

    // The books and the store stay in step: stock that did not arrive was not paid for.
    const after = await as(owner, 'get', '/finance/transactions?pageSize=1', coop).expect(200)
    expect(after.body.meta.totals.expenses).toBe('0.00')
  })

  it('refuses to reverse the same movement twice, or to reverse a reversal', async () => {
    const coop = await createCooperative('Double Reverse Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)

    const receipt = await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '10' })
      .expect(201)
    const first = await as(
      owner,
      'post',
      `/inventory/transactions/${receipt.body.data.id as string}/reverse`,
      coop,
    )
      .send({ reason: 'Once' })
      .expect(200)

    const again = await as(
      owner,
      'post',
      `/inventory/transactions/${receipt.body.data.id as string}/reverse`,
      coop,
    )
      .send({ reason: 'Twice' })
      .expect(409)
    expect(again.body.error.messageKey).toBe('errors.inventory.alreadyReversed')

    const reversalId = (first.body.data.reversals[0] as { id: string }).id
    const ofReversal = await as(
      owner,
      'post',
      `/inventory/transactions/${reversalId}/reverse`,
      coop,
    )
      .send({ reason: 'Undo the undo' })
      .expect(409)
    expect(ofReversal.body.error.messageKey).toBe('errors.inventory.isAReversal')
  })

  it('refuses a reversal with no reason', async () => {
    await as(manager, 'post', `/inventory/transactions/${crypto.randomUUID()}/reverse`)
      .send({})
      .expect(422)
  })
})

describe('the stock overview', () => {
  it('shows what is in each store, with the unit it is counted in', async () => {
    const response = await as(manager, 'get', '/inventory/stock?pageSize=100').expect(200)
    const row = (response.body.data as { productId: string; unitSymbol: string }[]).find(
      (candidate) => candidate.productId === maize,
    )
    expect(row?.unitSymbol).toBeTruthy()
    expect(typeof response.body.meta.lowCount).toBe('number')
  })

  it('marks a product at or below its minimum', async () => {
    const coop = await createCooperative('Low Stock Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)

    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '50' })
      .expect(201)

    const response = await as(owner, 'get', '/inventory/stock', coop).expect(200)
    const row = (response.body.data as { productId: string; isLow: boolean }[])[0]
    // The minimum is fifty, and fifty is at it rather than above it.
    expect(row?.isLow).toBe(true)
    expect(response.body.meta.lowCount).toBe(1)
  })

  it('narrows to what needs attention', async () => {
    const response = await as(manager, 'get', '/inventory/low-stock?pageSize=100').expect(200)
    expect((response.body.data as { isLow: boolean }[]).every((row) => row.isLow)).toBe(true)
  })

  it('refuses an unknown filter rather than ignoring it', async () => {
    await as(manager, 'get', '/inventory/stock?warehouse=whatever').expect(422)
    await as(manager, 'get', '/inventory/stock?sort=cost').expect(422)
  })
})

describe('the movement history', () => {
  it('totals what came in and what went out across the whole filter', async () => {
    const response = await as(manager, 'get', '/inventory/transactions?pageSize=2').expect(200)
    expect(response.body.data.length).toBeLessThanOrEqual(2)
    expect(response.body.meta.totals.in).toMatch(/^\d+\.\d{3}$/)
    expect(response.body.meta.totals.out).toMatch(/^\d+\.\d{3}$/)
  })

  it('filters by product, store, type, direction and date', async () => {
    const checks: [string, (row: Record<string, unknown>) => boolean][] = [
      [`productId=${maize}`, (row) => row.productId === maize],
      [`warehouseId=${store}`, (row) => row.warehouseId === store],
      ['type=RECEIPT', (row) => row.type === 'RECEIPT'],
      ['direction=OUT', (row) => row.direction === 'OUT'],
    ]
    for (const [query, holds] of checks) {
      const response = await as(manager, 'get', `/inventory/transactions?${query}`).expect(200)
      expect(
        (response.body.data as Record<string, unknown>[]).every(holds),
        `filter ${query}`,
      ).toBe(true)
    }
  })

  it('searches the reference, the product name and the code', async () => {
    const receipt = await as(storekeeper, 'post', '/inventory/receive')
      .send({ productId: maize, warehouseId: store, quantity: '5' })
      .expect(201)
    const reference = receipt.body.data.reference as string

    for (const query of [reference, 'Maize', 'MAIZE-GRAIN']) {
      const response = await as(
        manager,
        'get',
        `/inventory/transactions?q=${encodeURIComponent(query)}`,
      ).expect(200)
      expect(response.body.meta.total, `searching ${query}`).toBeGreaterThan(0)
    }
  })

  it('has no delete route', async () => {
    const response = await request(app)
      .delete(`${API_PREFIX}/inventory/transactions/${crypto.randomUUID()}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set(HEADERS.cooperativeId, cooperative.id)
    // The history is immutable, which is what makes a shortfall auditable.
    expect(response.status).toBe(404)
  })
})

describe('rebuilding the levels from the history', () => {
  /** The Phase 6 exit criterion. */
  it('reproduces every stored level exactly', async () => {
    const report = await rebuildStockLevels(cooperative.id)

    expect(report.pairs).toBeGreaterThan(0)
    expect(report.differences, JSON.stringify(report.differences)).toEqual([])
    expect(report.agrees).toBe(true)
  })

  it('finds a level that has been tampered with, and puts it back', async () => {
    const coop = await createCooperative('Rebuild Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)

    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '100' })
      .expect(201)
    await as(owner, 'post', '/inventory/issue', coop)
      .send({ productId, warehouseId, quantity: '40' })
      .expect(201)

    // Straight to the table, which nothing in the application ever does: this is what a restore
    // gone wrong or a hand-edited row looks like.
    await prisma.stockLevel.update({
      where: { productId_warehouseId: { productId, warehouseId } },
      data: { quantity: '999' },
    })

    const found = await rebuildStockLevels(coop.id)
    expect(found.agrees).toBe(false)
    expect(found.differences[0]?.stored).toBe('999.000')
    expect(found.differences[0]?.computed).toBe('60.000')

    const fixed = await rebuildStockLevels(coop.id, { apply: true })
    expect(fixed.differences).toHaveLength(1)

    const after = await rebuildStockLevels(coop.id)
    expect(after.agrees).toBe(true)
    const level = await prisma.stockLevel.findUniqueOrThrow({
      where: { productId_warehouseId: { productId, warehouseId } },
      select: { quantity: true },
    })
    expect(level.quantity.toString()).toBe('60')
  })

  it('counts a reversal like any other movement', async () => {
    const coop = await createCooperative('Rebuild Reversal Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)

    const receipt = await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '30' })
      .expect(201)
    await as(
      owner,
      'post',
      `/inventory/transactions/${receipt.body.data.id as string}/reverse`,
      coop,
    )
      .send({ reason: 'Never arrived' })
      .expect(200)

    // Nothing in the rebuild needs to know which rows correct which: a reversal is a movement with
    // its own direction and sums like one.
    const report = await rebuildStockLevels(coop.id)
    expect(report.agrees).toBe(true)
  })
})

describe('the low-stock watch', () => {
  it('raises one notification when a product falls to its minimum, not one per movement', async () => {
    const coop = await createCooperative('Watch Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)

    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '200' })
      .expect(201)
    let notifications = await prisma.notification.count({
      where: { cooperativeId: coop.id, type: 'LOW_STOCK' },
    })
    expect(notifications).toBe(0)

    // Down to forty, which is below the minimum of fifty.
    await as(owner, 'post', '/inventory/issue', coop)
      .send({ productId, warehouseId, quantity: '160' })
      .expect(201)
    await as(owner, 'post', '/inventory/issue', coop)
      .send({ productId, warehouseId, quantity: '10' })
      .expect(201)

    notifications = await prisma.notification.count({
      where: { cooperativeId: coop.id, type: 'LOW_STOCK' },
    })
    // An alert raised on every movement would stop being read.
    expect(notifications).toBe(1)

    const row = await prisma.notification.findFirstOrThrow({
      where: { cooperativeId: coop.id, type: 'LOW_STOCK' },
      select: {
        userId: true,
        severity: true,
        messageKey: true,
        messageParams: true,
        entityId: true,
      },
    })
    // Null means every member of staff, which is what a store warning is for.
    expect(row.userId).toBeNull()
    expect(row.severity).toBe('WARNING')
    // A key and its parameters, so an alert raised in English still reads in Kinyarwanda.
    expect(row.messageKey).toBe('notifications.lowStock.low')
    expect(row.entityId).toBe(productId)
    expect((row.messageParams as { minimum: string }).minimum).toBe('50.000')
  })

  it('treats an empty shelf as more serious than a low one', async () => {
    const coop = await createCooperative('Empty Watch Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)

    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '10' })
      .expect(201)
    await as(owner, 'post', '/inventory/issue', coop)
      .send({ productId, warehouseId, quantity: '10' })
      .expect(201)

    const row = await prisma.notification.findFirstOrThrow({
      where: { cooperativeId: coop.id, type: 'LOW_STOCK' },
      select: { severity: true, messageKey: true },
    })
    expect(row.severity).toBe('CRITICAL')
    expect(row.messageKey).toBe('notifications.lowStock.empty')
  })

  it('clears the alert when a receipt brings the stock back', async () => {
    const coop = await createCooperative('Cleared Watch Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)

    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '20' })
      .expect(201)
    expect(
      await prisma.notification.count({ where: { cooperativeId: coop.id, type: 'LOW_STOCK' } }),
    ).toBe(1)

    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '200' })
      .expect(201)

    // Removed rather than marked read, so the next dip raises a fresh warning instead of being
    // silenced for good by a row holding the key.
    expect(
      await prisma.notification.count({ where: { cooperativeId: coop.id, type: 'LOW_STOCK' } }),
    ).toBe(0)

    await as(owner, 'post', '/inventory/issue', coop)
      .send({ productId, warehouseId, quantity: '200' })
      .expect(201)
    expect(
      await prisma.notification.count({ where: { cooperativeId: coop.id, type: 'LOW_STOCK' } }),
    ).toBe(1)
  })

  it('agrees with the stock overview about how many products are short', async () => {
    const coop = await createCooperative('Agreement Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)
    const second = await as(owner, 'post', '/warehouses', coop)
      .send({ name: 'Second store' })
      .expect(201)

    // Forty in the main store and forty at the collection point: eighty in all, above the
    // minimum of fifty. One store being low is not the cooperative being short.
    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '40' })
      .expect(201)
    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId: second.body.data.id, quantity: '40' })
      .expect(201)

    const overview = await as(owner, 'get', '/inventory/stock', coop).expect(200)
    const alerts = await prisma.notification.count({
      where: { cooperativeId: coop.id, type: 'LOW_STOCK' },
    })

    // Two different answers to the same question is worse than either. Each row shows its own
    // store's quantity and the figure the minimum is actually compared against.
    expect(overview.body.meta.lowCount).toBe(alerts)
    expect(overview.body.meta.lowCount).toBe(0)
    const row = (overview.body.data as { quantity: string; quantityInAllStores: string }[])[0]
    expect(row?.quantity).toBe('40.000')
    expect(row?.quantityInAllStores).toBe('80.000')
  })

  it('counts stock across every store before deciding a cooperative is short', async () => {
    const coop = await createCooperative('Two Store Watch Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)
    const second = await as(owner, 'post', '/warehouses', coop)
      .send({ name: 'Second store' })
      .expect(201)

    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '30' })
      .expect(201)
    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId: second.body.data.id, quantity: '40' })
      .expect(201)

    // Seventy in total, above the minimum of fifty. A cooperative with fertiliser in the second
    // store has not run out, and warning it would teach the storekeeper to ignore the warnings.
    expect(
      await prisma.notification.count({ where: { cooperativeId: coop.id, type: 'LOW_STOCK' } }),
    ).toBe(0)
  })

  it('says nothing about a product that has never been in the store', async () => {
    const coop = await createCooperative('Never Held Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    await setUpStore(coop, owner)

    // Warning that a cooperative is short of something it has never stocked would be noise on
    // day one.
    const scan = await scanLowStock(coop.id)
    expect(scan.raised).toBe(0)
    expect(
      await prisma.notification.count({ where: { cooperativeId: coop.id, type: 'LOW_STOCK' } }),
    ).toBe(0)
  })

  it('reads the whole catalogue when run as a scheduled scan', async () => {
    const coop = await createCooperative('Scan Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)

    await as(owner, 'post', '/inventory/receive', coop)
      .send({ productId, warehouseId, quantity: '10' })
      .expect(201)
    await prisma.notification.deleteMany({ where: { cooperativeId: coop.id } })

    const scan = await scanLowStock(coop.id)
    expect(scan.raised).toBe(1)

    // Running it again changes nothing, which is the whole point of the unique key.
    const again = await scanLowStock(coop.id)
    expect(again.raised).toBe(0)
  })
})

describe('what the stock is worth', () => {
  it('values it at the weighted average of what was actually paid', async () => {
    const coop = await createCooperative('Valuation Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)
    const category = await prisma.financeCategory.create({
      data: { cooperativeId: coop.id, kind: 'EXPENSE', name: 'Stock purchases' },
      select: { id: true },
    })

    // A hundred at four hundred, then a hundred at five hundred: four hundred and fifty each.
    await as(owner, 'post', '/inventory/receive', coop)
      .send({
        productId,
        warehouseId,
        quantity: '100',
        unitCost: '400',
        expenseCategoryId: category.id,
      })
      .expect(201)
    await as(owner, 'post', '/inventory/receive', coop)
      .send({
        productId,
        warehouseId,
        quantity: '100',
        unitCost: '500',
        expenseCategoryId: category.id,
      })
      .expect(201)

    const response = await as(owner, 'get', '/inventory/valuation', coop).expect(200)
    const row = (response.body.data.rows as { unitCost: string; value: string }[])[0]
    expect(row?.unitCost).toBe('450.00')
    expect(row?.value).toBe('90000.00')
    expect(response.body.data.total).toBe('90000.00')
    expect(response.body.data.estimatedCount).toBe(0)
  })

  it('says which figures rest on a list price rather than on a receipt', async () => {
    const coop = await createCooperative('Estimated Valuation Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const unit = await as(owner, 'get', '/units', coop).expect(200)
    const unitId = (unit.body.data as { key: string; id: string }[]).find((row) => row.key === 'KG')
      ?.id as string
    const warehouse = await as(owner, 'post', '/warehouses', coop)
      .send({ name: 'Main store' })
      .expect(201)
    const product = await as(owner, 'post', '/products', coop)
      .send({ name: 'Never costed', unitId, defaultPurchasePrice: '300' })
      .expect(201)

    await as(owner, 'post', '/inventory/receive', coop)
      .send({
        productId: product.body.data.id,
        warehouseId: warehouse.body.data.id,
        quantity: '10',
      })
      .expect(201)

    const response = await as(owner, 'get', '/inventory/valuation', coop).expect(200)
    const row = (response.body.data.rows as { costIsEstimated: boolean; value: string }[])[0]
    // A cooperative taking this figure to a lender needs to know which part is an estimate.
    expect(row?.costIsEstimated).toBe(true)
    expect(row?.value).toBe('3000.00')
    expect(response.body.data.estimatedCount).toBe(1)
  })

  it('leaves a reversed receipt out of the average', async () => {
    const coop = await createCooperative('Reversed Cost Cooperative')
    const owner = await createStaffSession(app, coop, 'MANAGER')
    const { warehouseId, productId } = await setUpStore(coop, owner)
    const category = await prisma.financeCategory.create({
      data: { cooperativeId: coop.id, kind: 'EXPENSE', name: 'Stock purchases' },
      select: { id: true },
    })

    await as(owner, 'post', '/inventory/receive', coop)
      .send({
        productId,
        warehouseId,
        quantity: '100',
        unitCost: '400',
        expenseCategoryId: category.id,
      })
      .expect(201)
    const wrong = await as(owner, 'post', '/inventory/receive', coop)
      .send({
        productId,
        warehouseId,
        quantity: '100',
        unitCost: '9000',
        expenseCategoryId: category.id,
      })
      .expect(201)
    await as(owner, 'post', `/inventory/transactions/${wrong.body.data.id as string}/reverse`, coop)
      .send({ reason: 'Price typed wrongly' })
      .expect(200)

    const response = await as(owner, 'get', '/inventory/valuation', coop).expect(200)
    const row = (response.body.data.rows as { unitCost: string }[])[0]
    // A receipt that did not happen must not weight the average.
    expect(row?.unitCost).toBe('400.00')
  })

  it('needs both the stock and the money permission', async () => {
    // A storekeeper who may count sacks is not thereby entitled to know what they cost: the
    // inventory officer holds inventory:view and no finance permission at all.
    await as(storekeeper, 'get', '/inventory/valuation').expect(403)

    // An accountant holds both, and so does a manager.
    await as(accountant, 'get', '/inventory/valuation').expect(200)
    await as(manager, 'get', '/inventory/valuation').expect(200)
  })
})
