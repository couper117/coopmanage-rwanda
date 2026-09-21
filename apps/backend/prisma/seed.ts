import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import {
  ALL_PERMISSIONS,
  COOPERATIVE_PERMISSIONS,
  permissionScope,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  ROLE_SCOPE,
  splitPermission,
} from '@coopmanage/shared'
import argon2 from 'argon2'
import { randomBytes } from 'node:crypto'
import { COOPERATIVE_TYPES } from './seed-data/cooperative-types.js'
import { buildDemoFinance, DEMO_MEMBER_PAYMENTS } from './seed-data/demo-finance.js'
import { DEMO_BUYERS, DEMO_SALES } from './seed-data/demo-sales.js'
import {
  DEMO_MOVEMENTS,
  DEMO_PRODUCT_CATEGORIES,
  DEMO_PRODUCTS,
  DEMO_TRANSFERS,
  DEMO_WAREHOUSES,
} from './seed-data/demo-inventory.js'
import { buildDemoMembers } from './seed-data/demo-members.js'
import { DEMO_COOPERATIVE, DEMO_STAFF } from './seed-data/demo-cooperative.js'
import { assertDescriptionsComplete, PERMISSION_DESCRIPTIONS } from './seed-data/permissions.js'
import { ROLE_DESCRIPTIONS } from './seed-data/roles.js'
import {
  nextFinanceReference,
  nextInventoryReference,
  nextMemberCode,
} from '../src/lib/references.js'
import { defaultCategoriesFor } from '../src/modules/finance/finance.categories.js'
import { createHash } from 'node:crypto'
import { scanLowStock } from '../src/modules/inventory/lowStock.js'
import { newStorageKey, storage } from '../src/lib/storage/index.js'
import { decreaseStock, increaseStock } from '../src/modules/inventory/stock.js'
import {
  cancelSale,
  confirmSale,
  createBuyer,
  createSale,
} from '../src/modules/sales/sales.service.js'
import { Decimal } from '../src/lib/money.js'
import { voidTransaction } from '../src/modules/finance/finance.service.js'
import type { RequestContext } from '../src/lib/context.js'
import { SYSTEM_UNITS } from './seed-data/units.js'

/**
 * Reference data seed. Idempotent by design: it upserts, so running it twice changes nothing and
 * running it after a code change brings the database back in line with the catalogue.
 *
 * Demonstration data is a separate script (Phase 4 onward) gated behind SEED_DEMO.
 */
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required to seed')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

async function seedPermissions(): Promise<void> {
  assertDescriptionsComplete()
  for (const key of ALL_PERMISSIONS) {
    const { resource, action } = splitPermission(key)
    const description = PERMISSION_DESCRIPTIONS[key]
    await prisma.permission.upsert({
      where: { key },
      create: {
        key,
        resource,
        action,
        scope: permissionScope(key),
        descriptionEn: description.en,
        descriptionRw: description.rw,
      },
      update: {
        resource,
        action,
        scope: permissionScope(key),
        descriptionEn: description.en,
        descriptionRw: description.rw,
      },
    })
  }
  console.log(`  permissions: ${ALL_PERMISSIONS.length}`)
}

async function seedRoles(): Promise<void> {
  const permissionIdByKey = new Map(
    (await prisma.permission.findMany({ select: { id: true, key: true } })).map((row) => [
      row.key,
      row.id,
    ]),
  )

  for (const roleKey of ROLE_KEYS) {
    const meta = ROLE_DESCRIPTIONS[roleKey]
    const role = await prisma.role.upsert({
      where: { key: roleKey },
      create: {
        key: roleKey,
        nameEn: meta.nameEn,
        nameRw: meta.nameRw,
        descriptionEn: meta.descriptionEn,
        descriptionRw: meta.descriptionRw,
        scope: ROLE_SCOPE[roleKey],
        isSystem: true,
      },
      update: {
        nameEn: meta.nameEn,
        nameRw: meta.nameRw,
        descriptionEn: meta.descriptionEn,
        descriptionRw: meta.descriptionRw,
        scope: ROLE_SCOPE[roleKey],
      },
    })

    const wanted = ROLE_PERMISSIONS[roleKey]
    const wantedIds = wanted.map((key) => {
      const id = permissionIdByKey.get(key)
      if (!id) throw new Error(`Role ${roleKey} references unknown permission ${key}`)
      return id
    })

    // Replace the grant set so a permission removed from the matrix is actually revoked.
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { notIn: wantedIds } },
      }),
      prisma.rolePermission.createMany({
        data: wantedIds.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      }),
    ])

    console.log(`  role ${roleKey}: ${wanted.length} permissions`)
  }
}

async function seedCooperativeTypes(): Promise<void> {
  for (const type of COOPERATIVE_TYPES) {
    await prisma.cooperativeType.upsert({
      where: { key: type.key },
      create: {
        key: type.key,
        nameEn: type.nameEn,
        nameRw: type.nameRw,
        descriptionEn: type.descriptionEn,
        descriptionRw: type.descriptionRw,
        iconKey: type.iconKey,
        defaultUnitKeys: type.defaultUnitKeys,
        suggestedCategories: type.suggestedCategories,
        sortOrder: type.sortOrder,
      },
      update: {
        nameEn: type.nameEn,
        nameRw: type.nameRw,
        descriptionEn: type.descriptionEn,
        descriptionRw: type.descriptionRw,
        iconKey: type.iconKey,
        defaultUnitKeys: type.defaultUnitKeys,
        suggestedCategories: type.suggestedCategories,
        sortOrder: type.sortOrder,
      },
    })
  }
  console.log(`  cooperative types: ${COOPERATIVE_TYPES.length}`)
}

/**
 * System-wide units carry a null cooperative id. `upsert` cannot be used on them: the uniqueness
 * that makes a system unit unique is a partial index, which Prisma's `where` cannot address, so
 * the lookup is done explicitly.
 */
async function seedUnits(): Promise<void> {
  const idByKey = new Map<string, string>()

  for (const unit of SYSTEM_UNITS) {
    const existing = await prisma.unitOfMeasure.findFirst({
      where: { cooperativeId: null, key: unit.key },
      select: { id: true },
    })
    const data = {
      key: unit.key,
      nameEn: unit.nameEn,
      nameRw: unit.nameRw,
      symbol: unit.symbol,
      precision: unit.precision,
    }
    const row = existing
      ? await prisma.unitOfMeasure.update({
          where: { id: existing.id },
          data,
          select: { id: true },
        })
      : await prisma.unitOfMeasure.create({ data, select: { id: true } })
    idByKey.set(unit.key, row.id)
  }

  // Conversions are linked in a second pass, because a unit may point at one seeded after it.
  for (const unit of SYSTEM_UNITS) {
    if (!unit.baseUnitKey || !unit.factorToBase) continue
    const id = idByKey.get(unit.key)
    const baseUnitId = idByKey.get(unit.baseUnitKey)
    if (!id || !baseUnitId) throw new Error(`Unit ${unit.key} references an unseeded base unit`)
    await prisma.unitOfMeasure.update({
      where: { id },
      data: { baseUnitId, factorToBase: unit.factorToBase },
    })
  }

  console.log(`  system units: ${SYSTEM_UNITS.length}`)
}

const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 3,
  parallelism: 1,
} as const

/** Matches the rule in the shared catalogue: long, random, and not a word anyone would guess. */
function generatePassword(): string {
  return randomBytes(12).toString('base64url')
}

interface SeededPassword {
  email: string
  password: string | null
}

const announcements: SeededPassword[] = []

async function upsertUser(input: {
  email: string
  fullName: string
  phone?: string
  locale: 'EN' | 'RW'
  isPlatformAdmin: boolean
  envPassword: string | undefined
}): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  })

  // An existing account keeps its password. Re-running the seed must never reset the credentials
  // of an account somebody is already using, and must never print one it did not set.
  if (existing && !input.envPassword) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { fullName: input.fullName, phone: input.phone ?? null, locale: input.locale },
    })
    announcements.push({ email: input.email, password: null })
    return existing.id
  }

  const password = input.envPassword ?? generatePassword()
  const passwordHash = await argon2.hash(password, HASH_OPTIONS)
  // In production the password handed in through the environment is a bootstrap credential, not
  // the administrator's own: it sits in a hosting dashboard and in whoever's terminal set it. The
  // account therefore opens on the change-password screen, and docs/deployment.md has the operator
  // remove SEED_ADMIN_PASSWORD from the environment once they have signed in.
  const mustChangePassword = process.env.NODE_ENV === 'production'
  const user = await prisma.user.upsert({
    where: { email: input.email },
    create: {
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      phone: input.phone ?? null,
      locale: input.locale,
      isPlatformAdmin: input.isPlatformAdmin,
      mustChangePassword,
    },
    update: {
      passwordHash,
      fullName: input.fullName,
      phone: input.phone ?? null,
      locale: input.locale,
      isPlatformAdmin: input.isPlatformAdmin,
      mustChangePassword,
    },
    select: { id: true },
  })
  announcements.push({ email: input.email, password })
  return user.id
}

/**
 * The platform administrator. Its password comes from SEED_ADMIN_PASSWORD where one is given;
 * otherwise a random one is generated and printed once, here, and never stored anywhere else.
 * There is deliberately no default password: a known administrator credential shipped in a seed is
 * how installations get taken over.
 */
async function seedPlatformAdmin(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@coopmanage.rw'
  const envPassword = process.env.SEED_ADMIN_PASSWORD

  if (process.env.NODE_ENV === 'production' && !envPassword) {
    console.log('  platform administrator: skipped (set SEED_ADMIN_PASSWORD to create one)')
    return
  }

  await upsertUser({
    email,
    fullName: 'Platform administrator',
    locale: 'EN',
    isPlatformAdmin: true,
    envPassword,
  })
  console.log(`  platform administrator: ${email}`)
}

/**
 * One cooperative with a staff member in each of the five cooperative roles, so every screen can
 * be seen as each role sees it without inventing accounts by hand.
 */
async function seedDemoCooperative(): Promise<void> {
  const type = await prisma.cooperativeType.findUnique({
    where: { key: DEMO_COOPERATIVE.typeKey },
    select: { id: true },
  })
  if (!type) throw new Error(`Cooperative type ${DEMO_COOPERATIVE.typeKey} is not seeded`)

  const profile = {
    name: DEMO_COOPERATIVE.name,
    typeId: type.id,
    registrationNumber: DEMO_COOPERATIVE.registrationNumber,
    tinNumber: DEMO_COOPERATIVE.tinNumber,
    province: DEMO_COOPERATIVE.province,
    district: DEMO_COOPERATIVE.district,
    sector: DEMO_COOPERATIVE.sector,
    cell: DEMO_COOPERATIVE.cell,
    village: DEMO_COOPERATIVE.village,
    addressLine: DEMO_COOPERATIVE.addressLine,
    phone: DEMO_COOPERATIVE.phone,
    email: DEMO_COOPERATIVE.email,
    foundedOn: new Date(DEMO_COOPERATIVE.foundedOn),
    memberCodePrefix: DEMO_COOPERATIVE.memberCodePrefix,
    defaultLocale: DEMO_COOPERATIVE.defaultLocale,
    isDemo: true,
  }

  const cooperative = await prisma.cooperative.upsert({
    where: { code: DEMO_COOPERATIVE.code },
    create: { code: DEMO_COOPERATIVE.code, ...profile },
    update: profile,
    select: { id: true },
  })

  const roleIdByKey = new Map(
    (await prisma.role.findMany({ select: { id: true, key: true } })).map((row) => [
      row.key,
      row.id,
    ]),
  )
  const envPassword = process.env.SEED_DEMO_PASSWORD

  for (const staff of DEMO_STAFF) {
    const roleId = roleIdByKey.get(staff.roleKey)
    if (!roleId) throw new Error(`Role ${staff.roleKey} is not seeded`)

    const userId = await upsertUser({
      email: staff.email,
      fullName: staff.fullName,
      phone: staff.phone,
      locale: staff.locale,
      isPlatformAdmin: false,
      envPassword,
    })

    await prisma.cooperativeStaff.upsert({
      where: { cooperativeId_userId: { cooperativeId: cooperative.id, userId } },
      create: {
        cooperativeId: cooperative.id,
        userId,
        roleId,
        jobTitle: staff.jobTitle,
        joinedAt: new Date(),
      },
      update: { roleId, jobTitle: staff.jobTitle, status: 'ACTIVE', deactivatedAt: null },
    })
  }

  console.log(`  demonstration cooperative: ${DEMO_COOPERATIVE.name} (${DEMO_STAFF.length} staff)`)

  await seedFinanceCategories(cooperative.id, DEMO_COOPERATIVE.typeKey)
  await seedDemoMembers(cooperative.id)
  await seedDemoFinance(cooperative.id)
  await seedDemoInventory(cooperative.id)
  await seedDemoSales(cooperative.id)
  await seedDemoMeetings(cooperative.id)
  await seedDemoDocuments(cooperative.id)
  await seedDemoReportRun(cooperative.id)
}

/**
 * Finance categories for a cooperative.
 *
 * A contribution cannot be recorded without one, so seeding these is what makes the demonstration
 * cooperative usable rather than a shell. They are marked `isSystem`, which means they can be
 * deactivated but not deleted.
 */
async function seedFinanceCategories(cooperativeId: string, typeKey: string): Promise<void> {
  // The same list the application gives a cooperative created through the platform, so the
  // demonstration cooperative is not a special case and there is one definition of what a
  // cooperative starts with. Upserted rather than inserted, because the seed has to be safe to
  // run twice.
  const defaults = defaultCategoriesFor(typeKey)
  for (const [kind, entries] of [
    ['INCOME', defaults.income],
    ['EXPENSE', defaults.expense],
  ] as const) {
    for (const entry of entries) {
      await prisma.financeCategory.upsert({
        where: { cooperativeId_kind_name: { cooperativeId, kind, name: entry.name } },
        create: { cooperativeId, kind, name: entry.name, nameRw: entry.nameRw, isSystem: true },
        update: { nameRw: entry.nameRw, isActive: true },
      })
    }
  }
}

/**
 * Demonstration buyers and sales.
 *
 * Written through the application's own service functions rather than by inserting rows, so a
 * confirmed sale really does take the stock and post the income, a cancelled one really does write
 * its compensating movements, and the demonstration data is built by the same code a storekeeper's
 * sale goes through. Anything less would leave the seeded books and the seeded store able to
 * disagree, which is the failure the whole module is designed to prevent.
 *
 * Idempotent on the buyers already present.
 */
async function seedDemoSales(cooperativeId: string): Promise<void> {
  const existing = await prisma.buyer.count({ where: { cooperativeId } })
  if (existing > 0) {
    console.log(`  demonstration sales: ${existing} buyers already present, left alone`)
    return
  }

  const managerEmail = DEMO_STAFF[0]?.email
  const manager = managerEmail
    ? await prisma.user.findUnique({
        where: { email: managerEmail },
        select: { id: true, email: true, fullName: true, isPlatformAdmin: true, locale: true },
      })
    : null
  if (!manager) return

  const cooperative = await prisma.cooperative.findUniqueOrThrow({
    where: { id: cooperativeId },
    select: { id: true, name: true, code: true, isDemo: true },
  })

  // A context the services can act under. Every cooperative permission, because the seed is
  // standing in for a manager who holds them all.
  const ctx: RequestContext = {
    requestId: 'seed',
    sessionFamilyId: 'seed',
    user: manager,
    cooperative,
    permissions: new Set(COOPERATIVE_PERMISSIONS),
  }

  const buyerByName = new Map<string, string>()
  for (const buyer of DEMO_BUYERS) {
    const row = await createBuyer(ctx, buyer)
    buyerByName.set(buyer.name, row.id)
  }

  const warehouse = await prisma.warehouse.findFirstOrThrow({
    where: { cooperativeId, isDefault: true },
    select: { id: true },
  })
  const products = await prisma.product.findMany({
    where: { cooperativeId },
    select: { id: true, name: true },
  })
  const productByName = new Map(products.map((row) => [row.name, row.id]))
  const incomeCategory = await prisma.financeCategory.findFirstOrThrow({
    where: { cooperativeId, kind: 'INCOME', name: 'Sale of produce' },
    select: { id: true },
  })

  const year = new Date().getUTCFullYear()
  let confirmed = 0
  let drafts = 0
  let cancelled = 0

  for (const sale of DEMO_SALES) {
    const buyerId = buyerByName.get(sale.buyer)
    if (!buyerId) continue

    const saleDate = new Date(Date.UTC(year, sale.month - 1, sale.day))
    if (saleDate > new Date()) continue

    const lines = sale.lines
      .map((line) => ({
        productId: productByName.get(line.product),
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      }))
      .filter((line): line is { productId: string; quantity: string; unitPrice: string } =>
        Boolean(line.productId),
      )
    if (lines.length === 0) continue

    const draft = await createSale(ctx, {
      buyerId,
      warehouseId: warehouse.id,
      saleDate: saleDate.toISOString().slice(0, 10),
      lines: lines.map((line) => ({ ...line, note: null })),
      ...(sale.discount ? { discount: sale.discount } : {}),
      note: sale.note,
    })

    if (sale.state === 'DRAFT') {
      drafts += 1
      continue
    }

    // The store has to be able to fill it. A demonstration sale that failed here would leave the
    // seed half done, so a refusal is reported and the sale is left as a draft rather than
    // stopping the whole seed.
    try {
      await confirmSale(ctx, draft.id, {
        ...(sale.paid
          ? { amountPaid: sale.paid, method: 'MOBILE_MONEY', incomeCategoryId: incomeCategory.id }
          : {}),
      })
    } catch {
      console.log(`  demonstration sales: ${draft.reference} left as a draft, the store is short`)
      drafts += 1
      continue
    }

    if (sale.state === 'CANCELLED' && sale.cancelReason) {
      await cancelSale(ctx, draft.id, sale.cancelReason)
      cancelled += 1
      continue
    }
    confirmed += 1
  }

  console.log(
    `  demonstration sales: ${DEMO_BUYERS.length} buyers, ${confirmed} confirmed, ` +
      `${drafts} draft, ${cancelled} cancelled`,
  )
}

/**
 * The catalogue and the store.
 *
 * Written through the same `nextInventoryReference` allocator and the same movement shape the
 * application uses, so the demonstration store is indistinguishable from a store a storekeeper
 * kept. Idempotent on the products already present, so running the seed twice does not double
 * the catalogue.
 *
 * Opening balances are `OPENING` movements rather than stock levels written directly. That is the
 * point of the type: a level with no movement behind it would be the one row the rebuild command
 * could never explain, and a cooperative starting to keep records here genuinely does have stock
 * already in the store.
 */
async function seedDemoInventory(cooperativeId: string): Promise<void> {
  const existing = await prisma.product.count({ where: { cooperativeId } })
  if (existing > 0) {
    console.log(`  demonstration store: ${existing} products already present, left alone`)
    return
  }

  const managerEmail = DEMO_STAFF[0]?.email
  const manager = managerEmail
    ? await prisma.user.findUnique({ where: { email: managerEmail }, select: { id: true } })
    : null
  const createdById = manager?.id ?? null

  const units = await prisma.unitOfMeasure.findMany({
    where: { cooperativeId: null },
    select: { id: true, key: true },
  })
  const unitByKey = new Map(units.map((row) => [row.key, row.id]))

  const warehouseByCode = new Map<string, string>()
  for (const warehouse of DEMO_WAREHOUSES) {
    const row = await prisma.warehouse.upsert({
      where: { cooperativeId_code: { cooperativeId, code: warehouse.code } },
      create: { cooperativeId, ...warehouse },
      update: {},
      select: { id: true },
    })
    warehouseByCode.set(warehouse.code, row.id)
  }

  const categoryByName = new Map<string, string>()
  for (const category of DEMO_PRODUCT_CATEGORIES) {
    // Read then create, rather than an upsert. The unique is on
    // `(cooperative_id, name, parent_id)` and `parent_id` is nullable, which Prisma will not
    // accept as null in a compound unique `where`.
    const found = await prisma.productCategory.findFirst({
      where: { cooperativeId, name: category.name, parentId: null },
      select: { id: true },
    })
    const row =
      found ??
      (await prisma.productCategory.create({
        data: { cooperativeId, name: category.name, nameRw: category.nameRw },
        select: { id: true },
      }))
    categoryByName.set(category.name, row.id)
  }

  const productByName = new Map<string, { id: string; unitId: string }>()
  for (const product of DEMO_PRODUCTS) {
    const unitId = unitByKey.get(product.unitKey)
    if (!unitId) continue
    const sku = product.name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24)

    const row = await prisma.product.create({
      data: {
        cooperativeId,
        sku,
        name: product.name,
        nameRw: product.nameRw,
        categoryId: categoryByName.get(product.category) ?? null,
        unitId,
        type: product.type,
        trackInventory: product.trackInventory,
        minStockLevel: product.minStockLevel,
        defaultPurchasePrice: product.purchasePrice,
        defaultSalePrice: product.salePrice,
        createdById,
      },
      select: { id: true, unitId: true },
    })
    productByName.set(product.name, row)
  }

  /** One movement and its level, exactly as the application writes them. */
  async function move(input: {
    product: { id: string; unitId: string }
    warehouseId: string
    type: 'OPENING' | 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT' | 'TRANSFER_OUT' | 'TRANSFER_IN'
    direction: 'IN' | 'OUT'
    quantity: string
    occurredAt: Date
    unitCost?: string | null
    sourceMemberId?: string | null
    reason?: string | null
    note?: string | null
  }): Promise<string> {
    return prisma.$transaction(async (tx) => {
      const reference = await nextInventoryReference(tx, cooperativeId, input.occurredAt)
      const total =
        input.unitCost == null
          ? null
          : new Decimal(input.unitCost).times(new Decimal(input.quantity)).toFixed(2)

      const row = await tx.inventoryTransaction.create({
        data: {
          cooperativeId,
          reference,
          type: input.type,
          direction: input.direction,
          productId: input.product.id,
          warehouseId: input.warehouseId,
          quantity: input.quantity,
          unitId: input.product.unitId,
          unitCost: input.unitCost ?? null,
          totalCost: total,
          sourceMemberId: input.sourceMemberId ?? null,
          reason: input.reason ?? null,
          note: input.note ?? null,
          occurredAt: input.occurredAt,
          createdById,
        },
        select: { id: true },
      })

      // The application's own two operations, rather than a single upsert doing both directions.
      // A first attempt here inserted a negative candidate row for an outward movement and let
      // `ON CONFLICT` turn it into a subtraction — and PostgreSQL evaluates a check constraint on
      // the candidate row before the conflict resolves, so `stock_levels_quantity_not_negative`
      // refused it. Reusing `increaseStock` and `decreaseStock` means the demonstration store is
      // built by exactly the code a storekeeper's receipt goes through, which is the point.
      const key = {
        cooperativeId,
        productId: input.product.id,
        warehouseId: input.warehouseId,
      }
      const quantity = new Decimal(input.quantity)
      if (input.direction === 'IN') await increaseStock(tx, key, quantity)
      else await decreaseStock(tx, key, quantity)

      return row.id
    })
  }

  const year = new Date().getUTCFullYear()
  const openingDate = new Date(Date.UTC(year, 0, 2))

  for (const product of DEMO_PRODUCTS) {
    const row = productByName.get(product.name)
    if (!row) continue
    for (const opening of product.opening) {
      const warehouseId = warehouseByCode.get(opening.warehouse)
      if (!warehouseId) continue
      await move({
        product: row,
        warehouseId,
        type: 'OPENING',
        direction: 'IN',
        quantity: opening.quantity,
        unitCost: opening.unitCost,
        occurredAt: openingDate,
        note: 'What was already in the store when record-keeping began here',
      })
    }
  }

  // Members who delivered produce, taken in order so the same members are credited each run.
  const suppliers = await prisma.member.findMany({
    where: { cooperativeId, status: 'ACTIVE' },
    select: { id: true },
    orderBy: { memberCode: 'asc' },
    take: 20,
  })

  let supplierIndex = 0
  let movements = 0

  for (const movement of DEMO_MOVEMENTS) {
    const product = productByName.get(movement.product)
    const warehouseId = warehouseByCode.get(movement.warehouse)
    if (!product || !warehouseId) continue

    const occurredAt = new Date(Date.UTC(year, movement.month - 1, movement.day))
    if (occurredAt > new Date()) continue

    if (movement.type === 'ADJUSTMENT') {
      // The seed states what was counted, as the interface does, and works out the correction.
      const level = await prisma.stockLevel.findUnique({
        where: { productId_warehouseId: { productId: product.id, warehouseId } },
        select: { quantity: true },
      })
      const onRecord = level?.quantity ?? new Decimal(0)
      const difference = new Decimal(movement.quantity).minus(onRecord)
      if (difference.isZero()) continue

      await move({
        product,
        warehouseId,
        type: 'ADJUSTMENT',
        direction: difference.isPositive() ? 'IN' : 'OUT',
        quantity: difference.abs().toFixed(3),
        occurredAt,
        reason: movement.reason,
        note: movement.note,
      })
      movements += 1
      continue
    }

    const supplier = movement.fromMember ? suppliers[supplierIndex % suppliers.length] : undefined
    if (movement.fromMember) supplierIndex += 1

    await move({
      product,
      warehouseId,
      type: movement.type,
      direction: movement.type === 'RECEIPT' ? 'IN' : 'OUT',
      quantity: movement.quantity,
      occurredAt,
      ...(movement.type === 'RECEIPT'
        ? {
            unitCost:
              DEMO_PRODUCTS.find((row) => row.name === movement.product)?.purchasePrice ?? null,
          }
        : {}),
      sourceMemberId: supplier?.id ?? null,
      reason: movement.reason,
      note: movement.note,
    })
    movements += 1
  }

  for (const transfer of DEMO_TRANSFERS) {
    const product = productByName.get(transfer.product)
    const from = warehouseByCode.get(transfer.from)
    const to = warehouseByCode.get(transfer.to)
    if (!product || !from || !to) continue

    const occurredAt = new Date(Date.UTC(year, transfer.month - 1, transfer.day))
    if (occurredAt > new Date()) continue

    const outward = await move({
      product,
      warehouseId: from,
      type: 'TRANSFER_OUT',
      direction: 'OUT',
      quantity: transfer.quantity,
      occurredAt,
    })
    const inward = await move({
      product,
      warehouseId: to,
      type: 'TRANSFER_IN',
      direction: 'IN',
      quantity: transfer.quantity,
      occurredAt,
    })
    // Each half names the other, so the stock can be followed from either end.
    await prisma.inventoryTransaction.update({
      where: { id: outward },
      data: { counterpartyTransactionId: inward },
    })
    await prisma.inventoryTransaction.update({
      where: { id: inward },
      data: { counterpartyTransactionId: outward },
    })
    movements += 2
  }

  const low = await scanLowStock(cooperativeId)

  console.log(
    `  demonstration store: ${productByName.size} products, ${DEMO_WAREHOUSES.length} stores, ` +
      `${movements} movements, ${low.raised} low-stock warnings`,
  )
}

/**
 * The cooperative's own books: what it spent and what it sold, beyond the money that came from
 * members.
 *
 * Idempotent like the rest of the seed, keyed on the manual entries already present, so running
 * the seed twice does not double the cooperative's expenses.
 */
async function seedDemoFinance(cooperativeId: string): Promise<void> {
  const existing = await prisma.financeTransaction.count({
    where: { cooperativeId, sourceType: 'MANUAL' },
  })
  if (existing > 0) {
    console.log(`  demonstration ledger: ${existing} entries already present, left alone`)
    return
  }

  const categories = await prisma.financeCategory.findMany({
    where: { cooperativeId },
    select: { id: true, kind: true, name: true },
  })
  const byName = new Map(categories.map((row) => [`${row.kind}:${row.name}`, row.id]))

  const managerEmail = DEMO_STAFF[0]?.email
  const manager = managerEmail
    ? await prisma.user.findUnique({ where: { email: managerEmail }, select: { id: true } })
    : null

  const entries = buildDemoFinance(new Date().getUTCFullYear())
  let written = 0

  for (const entry of entries) {
    const categoryId = byName.get(`${entry.kind}:${entry.category}`)
    if (!categoryId) continue

    const occurredAt = new Date(Date.UTC(new Date().getUTCFullYear(), entry.month - 1, entry.day))

    // One transaction per entry, through the same reference allocator the application uses, so
    // the demonstration books are indistinguishable from books a treasurer kept.
    await prisma.$transaction(async (tx) => {
      const reference = await nextFinanceReference(
        tx,
        cooperativeId,
        entry.kind === 'INCOME' ? 'IN' : 'EX',
        occurredAt,
      )
      await tx.financeTransaction.create({
        data: {
          cooperativeId,
          reference,
          kind: entry.kind,
          categoryId,
          amount: entry.amount,
          occurredAt,
          method: entry.method,
          description: entry.description,
          sourceType: 'MANUAL',
          createdById: manager?.id ?? null,
        },
      })
    })
    written += 1
  }

  await seedDemoMemberPayments(cooperativeId, byName, manager?.id ?? null)
  await seedDemoCorrection(cooperativeId, manager)

  console.log(`  demonstration ledger: ${written} entries`)
}

/**
 * One contribution recorded twice and then cancelled, so the demonstration books show a
 * correction.
 *
 * Every screen in the finance module has to say something about a cancelled entry: the status
 * column, the two columns naming what corrects what, the row that is muted rather than removed,
 * and the totals that count neither the mistake nor its correction. With nothing voided in the
 * demonstration data, none of that is visible and a manager judging the software cannot see that
 * a mistake is recoverable.
 *
 * Done through `voidTransaction`, the same function the API uses, rather than by writing two rows
 * here. A second definition of what a reversal is would be a second thing to get wrong.
 */
async function seedDemoCorrection(
  cooperativeId: string,
  manager: { id: string } | null,
): Promise<void> {
  if (!manager) return

  const already = await prisma.financeTransaction.count({
    where: { cooperativeId, status: 'VOID' },
  })
  if (already > 0) return

  const account = await prisma.user.findUnique({
    where: { id: manager.id },
    select: { id: true, email: true, fullName: true, isPlatformAdmin: true, locale: true },
  })
  const cooperative = await prisma.cooperative.findUniqueOrThrow({
    where: { id: cooperativeId },
    select: { id: true, name: true, code: true, isDemo: true },
  })
  if (!account) return

  // The contribution that gets cancelled is a duplicate the seed writes for the purpose, so no
  // member's history loses a payment they actually made.
  const member = await prisma.member.findFirst({
    where: { cooperativeId, status: 'ACTIVE' },
    select: { id: true, firstName: true, lastName: true, memberCode: true },
    orderBy: { memberCode: 'asc' },
  })
  const categoryId = (
    await prisma.financeCategory.findFirst({
      where: { cooperativeId, kind: 'INCOME', name: 'Membership fees' },
      select: { id: true },
    })
  )?.id
  if (!member || !categoryId) return

  const ctx: RequestContext = {
    requestId: 'seed',
    sessionFamilyId: 'seed',
    user: account,
    cooperative,
    permissions: new Set(),
  }

  const occurredAt = new Date(Date.UTC(new Date().getUTCFullYear(), 7, 14))

  const duplicate = await prisma.$transaction(async (tx) => {
    const reference = await nextFinanceReference(tx, cooperativeId, 'IN', occurredAt)
    const row = await tx.financeTransaction.create({
      data: {
        cooperativeId,
        reference,
        kind: 'INCOME',
        categoryId,
        amount: '5000.00',
        occurredAt,
        method: 'CASH',
        description: `MEMBERSHIP_FEE from ${member.firstName} ${member.lastName} (${member.memberCode})`,
        sourceType: 'MANUAL',
        memberId: member.id,
        createdById: account.id,
      },
      select: { id: true },
    })
    return row.id
  })

  await prisma.$transaction((tx) =>
    voidTransaction(tx, ctx, duplicate, 'Recorded twice by mistake'),
  )
}

/**
 * The twelve members paid individually, so a profile shows a payment rather than nil.
 *
 * Attached to the twelve members with the most contributions, because those are the ones who
 * delivered the most and would be paid the most, which is the shape a manager recognises.
 */
async function seedDemoMemberPayments(
  cooperativeId: string,
  categoryByName: Map<string, string>,
  createdById: string | null,
): Promise<void> {
  const categoryId = categoryByName.get('EXPENSE:Payments to members')
  if (!categoryId) return

  const members = await prisma.member.findMany({
    where: { cooperativeId, status: 'ACTIVE' },
    select: { id: true, firstName: true, lastName: true, memberCode: true },
    orderBy: { memberCode: 'asc' },
    take: DEMO_MEMBER_PAYMENTS.length,
  })

  const occurredAt = new Date(Date.UTC(new Date().getUTCFullYear(), 8, 3))

  for (const [index, member] of members.entries()) {
    const amount = DEMO_MEMBER_PAYMENTS[index]
    if (!amount) continue

    await prisma.$transaction(async (tx) => {
      const reference = await nextFinanceReference(tx, cooperativeId, 'EX', occurredAt)
      await tx.financeTransaction.create({
        data: {
          cooperativeId,
          reference,
          kind: 'EXPENSE',
          categoryId,
          amount,
          occurredAt,
          method: 'MOBILE_MONEY',
          description: `Payment for delivered maize to ${member.firstName} ${member.lastName} (${member.memberCode})`,
          sourceType: 'MANUAL',
          memberId: member.id,
          createdById,
        },
      })
    })
  }
}

/**
 * The register, and the money that hangs off it.
 *
 * Idempotent like the rest of the seed: it does nothing when the register is already populated,
 * so running the seed twice does not double the cooperative's membership. Member codes come from
 * the same allocator the application uses, so the demonstration data is indistinguishable from
 * data a secretary entered.
 */
/**
 * One report already produced, so the demonstration cooperative's reports screen shows a history
 * rather than an empty panel on the first visit.
 *
 * The run is written directly rather than by calling the export: producing a PDF during the seed
 * would slow it for no gain, and a download reproduces the report from `params` anyway, so this row
 * behaves exactly like one a real export wrote. The notification goes with it, because a run that
 * raised none would misrepresent what the module does.
 */
/**
 * Two meetings: last quarter's general assembly, closed with its record complete, and the next one
 * still scheduled.
 *
 * The closed one is what makes the demonstration worth looking at — an agenda, attendance taken
 * against the register, a quorum that was met, and two decisions one of which is an action still
 * open. A cooperative evaluating the system sees the governance record as it will actually look,
 * not an empty screen with a button on it.
 */
async function seedDemoMeetings(cooperativeId: string): Promise<void> {
  if ((await prisma.meeting.count({ where: { cooperativeId } })) > 0) {
    console.log('  demonstration meetings already present, left alone')
    return
  }

  const staff = await prisma.cooperativeStaff.findMany({
    where: { cooperativeId },
    select: { id: true, role: { select: { key: true } } },
  })
  const secretary = staff.find((row) => row.role.key === 'SECRETARY') ?? staff[0]
  const manager = staff.find((row) => row.role.key === 'MANAGER') ?? staff[0]
  if (!secretary || !manager) return

  const members = await prisma.member.findMany({
    where: { cooperativeId, status: 'ACTIVE' },
    orderBy: { memberCode: 'asc' },
    select: { id: true },
  })

  const now = new Date()
  const held = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 12, 8, 0, 0))
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 12, 8, 0, 0))

  // A quorum of just over half the register, which is the rule most Rwandan cooperatives' own
  // statutes set.
  const quorum = Math.max(1, Math.ceil(members.length / 2))

  const assembly = await prisma.meeting.create({
    data: {
      cooperativeId,
      reference: `MTG-${held.getUTCFullYear()}-000001`,
      title: "Inteko rusange y'igihembwe",
      type: 'GENERAL_ASSEMBLY',
      scheduledFor: held,
      endsAt: new Date(held.getTime() + 3 * 60 * 60 * 1000),
      location: 'Inzu ya koperative, Muhoza',
      status: 'COMPLETED',
      quorumRequired: quorum,
      createdById: (await staffUserId(secretary.id)) ?? null,
      agenda: {
        create: [
          { position: 1, title: "Ifungura n'ikurikirana ry'abitabiriye" },
          {
            position: 2,
            title: "Raporo y'imari y'igihembwe",
            presenterStaffId: manager.id,
          },
          { position: 3, title: "Umwuma w'ibigori wa kabiri" },
        ],
      },
      attendees: {
        create: [
          // Three-quarters of the register attended, which clears the quorum, and the rest are
          // recorded as absent rather than left out: attendance is taken against the register.
          ...members.map((member, index) => ({
            memberId: member.id,
            status: index % 4 === 3 ? ('ABSENT' as const) : ('PRESENT' as const),
            checkedInAt: index % 4 === 3 ? null : held,
          })),
          {
            guestName: "Umukozi w'akarere ushinzwe amakoperative",
            status: 'PRESENT' as const,
            checkedInAt: held,
            note: "Yitabiriye nk'umugenzuzi",
          },
        ],
      },
    },
    select: { id: true, agenda: { select: { id: true, position: true } } },
  })

  const dryerItem = assembly.agenda.find((item) => item.position === 3)

  await prisma.meetingDecision.createMany({
    data: [
      {
        meetingId: assembly.id,
        agendaItemId: dryerItem?.id ?? null,
        title: "Kugura umwuma wa kabiri w'ibigori mbere y'isarura",
        description: "Guhera ku bwizigame bwa koperative, hatanzwe amasezerano abiri y'ibiciro.",
        decisionType: 'RESOLUTION',
        votesFor: Math.max(1, Math.floor(members.length * 0.7)),
        votesAgainst: 2,
        abstentions: 1,
        status: 'DONE',
      },
      {
        meetingId: assembly.id,
        title: "Gusana igisenge cy'ububiko",
        decisionType: 'ACTION',
        dueOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1)),
        responsibleStaffId: manager.id,
        status: 'OPEN',
      },
    ],
  })

  await prisma.meeting.create({
    data: {
      cooperativeId,
      reference: `MTG-${next.getUTCFullYear()}-000002`,
      title: "Inama y'ubuyobozi",
      type: 'BOARD',
      scheduledFor: next,
      location: 'Inzu ya koperative, Muhoza',
      status: 'SCHEDULED',
      createdById: (await staffUserId(secretary.id)) ?? null,
      agenda: {
        create: [
          { position: 1, title: "Ikurikirana ry'ibyemezo byashize" },
          { position: 2, title: 'Gutegura isarura' },
        ],
      },
    },
  })

  console.log('  demonstration meetings: one held, one scheduled')
}

async function staffUserId(staffId: string): Promise<string | null> {
  const row = await prisma.cooperativeStaff.findUnique({
    where: { id: staffId },
    select: { userId: true },
  })
  return row?.userId ?? null
}

/**
 * Two documents, with real bytes behind them.
 *
 * Written through the storage driver rather than inserted as rows alone, so the demonstration's
 * download actually downloads something — a row with no file behind it would show the reader the
 * one failure mode this module is careful to report rather than the module working.
 *
 * The files are generated here: a one-page PDF is a few hundred bytes of PostScript and needs no
 * fixture in the repository.
 */
async function seedDemoDocuments(cooperativeId: string): Promise<void> {
  if ((await prisma.document.count({ where: { cooperativeId } })) > 0) {
    console.log('  demonstration documents already present, left alone')
    return
  }

  const staff = await prisma.cooperativeStaff.findFirst({
    where: { cooperativeId, role: { key: 'SECRETARY' } },
    select: { userId: true },
  })
  const uploadedById = staff?.userId ?? null

  const meeting = await prisma.meeting.findFirst({
    where: { cooperativeId, status: 'COMPLETED' },
    select: { id: true },
  })

  const papers = [
    {
      title: "Icyemezo cy'iyandikwa rya koperative",
      category: 'REGISTRATION' as const,
      fileName: 'icyemezo-cyiyandikwa.pdf',
      body: "Icyemezo cy'iyandikwa rya koperative — RCA",
      meetingId: null,
    },
    {
      title: "Inyandikomvugo y'inteko rusange",
      category: 'MEETING_MINUTES' as const,
      fileName: 'inyandikomvugo-inteko-rusange.pdf',
      body: "Inyandikomvugo y'inteko rusange y'igihembwe",
      meetingId: meeting?.id ?? null,
    },
  ]

  for (const paper of papers) {
    const bytes = onePagePdf(paper.body)
    const key = newStorageKey()
    await storage().put(key, bytes, 'application/pdf')

    const document = await prisma.document.create({
      data: {
        cooperativeId,
        title: paper.title,
        category: paper.category,
        fileName: paper.fileName,
        storageKey: key,
        mimeType: 'application/pdf',
        sizeBytes: BigInt(bytes.length),
        checksumSha256: createHash('sha256').update(bytes).digest('hex'),
        visibility: 'COOPERATIVE',
        meetingId: paper.meetingId,
        uploadedById,
        tags: paper.category === 'REGISTRATION' ? ['iyandikwa', 'rca'] : ['inama'],
      },
      select: { id: true },
    })

    // The minutes are attached to the meeting they belong to, which is what a cooperative's own
    // filing does and what the minutes report reads to say whether they were filed.
    if (paper.category === 'MEETING_MINUTES' && paper.meetingId) {
      await prisma.meeting.update({
        where: { id: paper.meetingId },
        data: { minutesDocumentId: document.id },
      })
    }
  }

  console.log('  demonstration documents: two papers filed, with the minutes attached')
}

/**
 * Text in Windows-1252, which is what `/WinAnsiEncoding` means in a PDF.
 *
 * Only two characters need it and both are Kinyarwanda punctuation: the right single quotation
 * mark in `cy'iyandikwa` and the em dash. Writing the string's UTF-8 bytes instead — which the
 * first version of this did — turned `Icyemezo cy'iyandikwa` into `Icyemezo cy iyandikwa` in the
 * rendered page, because the viewer dropped the bytes it could not map.
 */
function winAnsi(text: string): string {
  const replacements: Readonly<Record<string, string>> = {
    '\u2019': '\u0092',
    '\u2018': '\u0091',
    '\u201c': '\u0093',
    '\u201d': '\u0094',
    '\u2013': '\u0096',
    '\u2014': '\u0097',
    '\u2026': '\u0085',
  }
  return [...text]
    .map((character) => replacements[character] ?? character)
    .filter((character) => character.charCodeAt(0) < 256)
    .join('')
}

/**
 * A valid one-page PDF, built by hand.
 *
 * Small enough to read: five objects, a cross-reference table with correct byte offsets, and a
 * trailer. Generating it means the repository carries no binary fixture, and it is a real PDF, so
 * the demonstration's preview shows a page rather than a broken frame.
 */
function onePagePdf(text: string): Buffer {
  const escaped = winAnsi(text)
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
  const content = `BT /F1 16 Tf 72 720 Td (${escaped}) Tj ET\n`

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ]

  let body = ''
  const offsets: number[] = []
  const header = '%PDF-1.4\n'
  let at = header.length

  objects.forEach((object, index) => {
    const chunk = `${index + 1} 0 obj\n${object}\nendobj\n`
    offsets.push(at)
    body += chunk
    at += chunk.length
  })

  const xrefAt = at
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`

  return Buffer.from(header + body + xref + trailer, 'latin1')
}

async function seedDemoReportRun(cooperativeId: string): Promise<void> {
  const manager = await prisma.cooperativeStaff.findFirst({
    where: { cooperativeId, role: { key: 'MANAGER' } },
    select: { userId: true },
  })
  if (!manager) return

  // Last month, which is the period a committee meets about.
  const today = new Date()
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0))
  const params = {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    locale: 'RW' as const,
  }

  const existing = await prisma.reportRun.findFirst({
    where: { cooperativeId, type: 'monthly-cooperative' },
    select: { id: true },
  })
  if (existing) return

  const completedAt = new Date(end.getTime() + 9 * 60 * 60 * 1000)
  const run = await prisma.reportRun.create({
    data: {
      cooperativeId,
      type: 'monthly-cooperative',
      params,
      format: 'PDF',
      status: 'READY',
      rowCount: 6,
      generatedById: manager.userId,
      createdAt: completedAt,
      completedAt,
    },
    select: { id: true },
  })

  await prisma.notification.upsert({
    where: { cooperativeId_dedupeKey: { cooperativeId, dedupeKey: `report:${run.id}` } },
    update: {},
    create: {
      cooperativeId,
      userId: manager.userId,
      type: 'REPORT_READY',
      severity: 'INFO',
      messageKey: 'notifications.report.ready',
      messageParams: {
        report: 'report.monthly-cooperative',
        period: `${params.from} → ${params.to}`,
      },
      entityType: 'ReportRun',
      entityId: run.id,
      actionUrl: `/reports/runs/${run.id}`,
      dedupeKey: `report:${run.id}`,
      createdAt: completedAt,
    },
  })

  console.log('  one monthly report run recorded')
}

async function seedDemoMembers(cooperativeId: string): Promise<void> {
  const existing = await prisma.member.count({ where: { cooperativeId } })
  if (existing > 0) {
    console.log(`  demonstration members: ${existing} already present, left alone`)
    return
  }

  const [feeCategory, savingsCategory, shareCategory] = await Promise.all([
    prisma.financeCategory.findFirstOrThrow({
      where: { cooperativeId, kind: 'INCOME', name: 'Membership fees' },
      select: { id: true },
    }),
    prisma.financeCategory.findFirstOrThrow({
      where: { cooperativeId, kind: 'INCOME', name: 'Savings deposits' },
      select: { id: true },
    }),
    prisma.financeCategory.findFirstOrThrow({
      where: { cooperativeId, kind: 'INCOME', name: 'Share capital' },
      select: { id: true },
    }),
  ])

  // The demonstration manager, credited as the person who registered every member, so the audit
  // trail and the "recorded by" fields read like a real cooperative's.
  const managerEmail = DEMO_STAFF[0]?.email
  const manager = managerEmail
    ? await prisma.user.findUnique({ where: { email: managerEmail }, select: { id: true } })
    : null

  const members = buildDemoMembers(120)
  let contributions = 0
  let shares = 0

  for (const [index, seed] of members.entries()) {
    const joinedOn = new Date(`${seed.joinedOn}T00:00:00.000Z`)

    // One transaction per member, so the code allocation is atomic exactly as it is in the
    // application. Slower than a bulk insert, and the right thing: the seed exercises the same
    // path a secretary does.
    await prisma.$transaction(async (tx) => {
      const memberCode = await nextMemberCode(tx, cooperativeId)
      const member = await tx.member.create({
        data: {
          cooperativeId,
          memberCode,
          firstName: seed.firstName,
          lastName: seed.lastName,
          gender: seed.gender,
          phone: seed.phone,
          province: 'NORTHERN',
          district: seed.district,
          sector: seed.sector,
          cell: seed.cell,
          village: seed.village,
          joinedOn,
          position: seed.position,
          status: seed.status,
          exitedOn: seed.status === 'EXITED' ? joinedOn : null,
          exitReason: seed.status === 'EXITED' ? 'Moved away from the district' : null,
          createdById: manager?.id ?? null,
          updatedById: manager?.id ?? null,
        },
        select: { id: true, memberCode: true },
      })

      // A membership fee for everyone, so every member has at least one figure on their profile.
      const fee = 5000
      const feeReference = await nextFinanceReference(tx, cooperativeId, 'IN', joinedOn)
      const feeTransaction = await tx.financeTransaction.create({
        data: {
          cooperativeId,
          reference: feeReference,
          kind: 'INCOME',
          categoryId: feeCategory.id,
          amount: fee,
          occurredAt: joinedOn,
          method: 'CASH',
          description: `MEMBERSHIP_FEE from ${seed.firstName} ${seed.lastName} (${member.memberCode})`,
          sourceType: 'CONTRIBUTION',
          memberId: member.id,
          createdById: manager?.id ?? null,
        },
        select: { id: true },
      })
      await tx.contribution.create({
        data: {
          cooperativeId,
          memberId: member.id,
          type: 'MEMBERSHIP_FEE',
          amount: fee,
          paidOn: joinedOn,
          method: 'CASH',
          financeTransactionId: feeTransaction.id,
          createdById: manager?.id ?? null,
        },
      })
      contributions += 1

      // Savings for roughly half, in varying amounts, so the totals are not uniform.
      if (index % 2 === 0) {
        const amount = 10000 + (index % 9) * 2500
        const paidOn = new Date(Date.UTC(2026, index % 9, (index % 27) + 1))
        const reference = await nextFinanceReference(tx, cooperativeId, 'IN', paidOn)
        const transaction = await tx.financeTransaction.create({
          data: {
            cooperativeId,
            reference,
            kind: 'INCOME',
            categoryId: savingsCategory.id,
            amount,
            occurredAt: paidOn,
            method: index % 4 === 0 ? 'MOBILE_MONEY' : 'CASH',
            description: `SAVINGS from ${seed.firstName} ${seed.lastName} (${member.memberCode})`,
            sourceType: 'CONTRIBUTION',
            memberId: member.id,
            createdById: manager?.id ?? null,
          },
          select: { id: true },
        })
        await tx.contribution.create({
          data: {
            cooperativeId,
            memberId: member.id,
            type: 'SAVINGS',
            amount,
            paidOn,
            method: index % 4 === 0 ? 'MOBILE_MONEY' : 'CASH',
            financeTransactionId: transaction.id,
            createdById: manager?.id ?? null,
          },
        })
        contributions += 1
      }

      // Shares for about a third, so the share ledger has something in it.
      if (index % 3 === 0) {
        const quantity = 1 + (index % 8)
        const unitValue = 10000
        const totalValue = quantity * unitValue
        const issuedOn = new Date(Date.UTC(2026, (index % 6) + 1, (index % 25) + 1))
        const reference = await nextFinanceReference(tx, cooperativeId, 'IN', issuedOn)
        const transaction = await tx.financeTransaction.create({
          data: {
            cooperativeId,
            reference,
            kind: 'INCOME',
            categoryId: shareCategory.id,
            amount: totalValue,
            occurredAt: issuedOn,
            method: 'CASH',
            description: `Share capital from ${seed.firstName} ${seed.lastName} (${member.memberCode})`,
            sourceType: 'SHARE_PURCHASE',
            memberId: member.id,
            createdById: manager?.id ?? null,
          },
          select: { id: true },
        })
        await tx.memberShare.create({
          data: {
            cooperativeId,
            memberId: member.id,
            type: 'PURCHASE',
            quantity,
            unitValue,
            totalValue,
            issuedOn,
            certificateNo: `CERT-${member.memberCode}`,
            financeTransactionId: transaction.id,
            createdById: manager?.id ?? null,
          },
        })
        shares += 1
      }
    })
  }

  console.log(
    `  demonstration members: ${members.length}, contributions: ${contributions}, share purchases: ${shares}`,
  )
}

function reportPasswords(): void {
  const created = announcements.filter((row) => row.password !== null)
  if (created.length === 0) return
  console.log('\nSign-in details. These are shown once and are not stored anywhere else:')
  for (const row of created) console.log(`  ${row.email}  ${row.password}`)
  console.log('')
}

async function main(): Promise<void> {
  console.log('Seeding reference data...')
  await seedPermissions()
  await seedRoles()
  await seedCooperativeTypes()
  await seedUnits()
  await seedPlatformAdmin()

  const demoRequested = process.env.SEED_DEMO === 'true' || process.env.SEED_DEMO === '1'

  /**
   * Demonstration data never goes into production, whatever the environment says.
   *
   * The demonstration cooperative is five staff accounts sharing one password, 120 members with
   * invented names, and a year of invented money. On a production system that is a set of working
   * credentials nobody meant to create and a cooperative nobody can tell from a real one — and
   * `SEED_DEMO=true` is one copied line in a deployment configuration away.
   *
   * Refused rather than skipped: an operator who asked for demonstration data in production has
   * misunderstood something, and a silent skip would leave them looking for a cooperative that was
   * never going to appear. Found in the Phase 15 review.
   */
  if (demoRequested && process.env.NODE_ENV === 'production') {
    throw new Error(
      'SEED_DEMO is set in production. Demonstration data is five accounts sharing one password ' +
        'and a year of invented money; it must never be created on a production system. Unset ' +
        'SEED_DEMO, or run this against a development database.',
    )
  }

  if (demoRequested) {
    console.log('Seeding demonstration data...')
    await seedDemoCooperative()
  }

  reportPasswords()
  console.log('Seed complete.')
}

try {
  await main()
} catch (error) {
  console.error('Seed failed:', error)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
