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
import { COOPERATIVE_TYPES } from './seed-data/cooperative-types.js'
import { assertDescriptionsComplete, PERMISSION_DESCRIPTIONS } from './seed-data/permissions.js'
import { ROLE_DESCRIPTIONS } from './seed-data/roles.js'

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

async function main(): Promise<void> {
  console.log('Seeding reference data...')
  await seedPermissions()
  await seedRoles()
  await seedCooperativeTypes()
  console.log('Reference data seeded.')
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
