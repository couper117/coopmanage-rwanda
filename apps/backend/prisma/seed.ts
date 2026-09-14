import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import {
  ALL_PERMISSIONS,
  permissionScope,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  ROLE_SCOPE,
  splitPermission,
} from '@coopmanage/shared'
import argon2 from 'argon2'
import { randomBytes } from 'node:crypto'
import { COOPERATIVE_TYPES } from './seed-data/cooperative-types.js'
import { buildDemoFinance } from './seed-data/demo-finance.js'
import { buildDemoMembers } from './seed-data/demo-members.js'
import { DEMO_COOPERATIVE, DEMO_STAFF } from './seed-data/demo-cooperative.js'
import { assertDescriptionsComplete, PERMISSION_DESCRIPTIONS } from './seed-data/permissions.js'
import { ROLE_DESCRIPTIONS } from './seed-data/roles.js'
import { nextFinanceReference, nextMemberCode } from '../src/lib/references.js'
import { defaultCategoriesFor } from '../src/modules/finance/finance.categories.js'
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
  const user = await prisma.user.upsert({
    where: { email: input.email },
    create: {
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      phone: input.phone ?? null,
      locale: input.locale,
      isPlatformAdmin: input.isPlatformAdmin,
    },
    update: {
      passwordHash,
      fullName: input.fullName,
      phone: input.phone ?? null,
      locale: input.locale,
      isPlatformAdmin: input.isPlatformAdmin,
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

  console.log(`  demonstration ledger: ${written} entries`)
}

/**
 * The register, and the money that hangs off it.
 *
 * Idempotent like the rest of the seed: it does nothing when the register is already populated,
 * so running the seed twice does not double the cooperative's membership. Member codes come from
 * the same allocator the application uses, so the demonstration data is indistinguishable from
 * data a secretary entered.
 */
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

  if (process.env.SEED_DEMO === 'true' || process.env.SEED_DEMO === '1') {
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
