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
import { DEMO_COOPERATIVE, DEMO_STAFF } from './seed-data/demo-cooperative.js'
import { assertDescriptionsComplete, PERMISSION_DESCRIPTIONS } from './seed-data/permissions.js'
import { ROLE_DESCRIPTIONS } from './seed-data/roles.js'
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
