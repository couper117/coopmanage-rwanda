import { randomBytes } from 'node:crypto'
import {
  SYSTEM_SETTING_DEFAULTS,
  type SystemSettingKey,
  type SystemSettings,
} from '@coopmanage/shared'
import { writeAudit } from '../../lib/audit.js'
import type { RequestContext } from '../../lib/context.js'
import { isUniqueViolation } from '../../lib/dbErrors.js'
import { AppError } from '../../lib/errors.js'
import { hashPassword } from '../../lib/password.js'
import { prisma } from '../../lib/prisma.js'
import { seedFinanceCategories } from '../finance/finance.categories.js'
import { issuePasswordSetupLink } from '../auth/passwordSetup.js'
import { checkDatabase } from '../../lib/prisma.js'
import { SYSTEM_SETTING_VALIDATORS } from './admin.schemas.js'
import type {
  createCooperativeSchema,
  createUserSchema,
  updateCooperativeStatusSchema,
  updateUserSchema,
} from './admin.schemas.js'
import type { z } from 'zod'

/**
 * Platform administration. Every function here reaches across tenants by design, which is exactly
 * why each one writes to the audit trail and why the endpoints sit behind `platform:*` permissions
 * that no cooperative role can hold.
 *
 * Nothing in this module reads or writes a cooperative's records. It manages organisations and
 * accounts; a platform operator who needs to see inside a cooperative is given an ordinary staff
 * role by that cooperative's manager.
 */

export interface AdminCooperativeDto {
  id: string
  code: string
  name: string
  typeKey: string
  status: string
  isDemo: boolean
  province: string
  district: string
  registrationNumber: string | null
  staffCount: number
  activeStaffCount: number
  createdAt: string
}

/**
 * Reads one cooperative by id, for the two callers that have just written it.
 *
 * The first version re-read the row with `listCooperatives({ q: code })`, which is a
 * case-insensitive `contains` search ordered by name: a short code that is a substring of another
 * cooperative's could return the wrong record. An id is exact.
 */
async function cooperativeById(id: string): Promise<AdminCooperativeDto> {
  const { items } = await listCooperatives({ id, page: 1, pageSize: 1 })
  const dto = items[0]
  if (!dto) throw AppError.notFound()
  return dto
}

export async function listCooperatives(filters: {
  id?: string
  q?: string
  status?: string
  typeKey?: string
  includeDemo?: 'true' | 'false'
  page: number
  pageSize: number
}): Promise<{ items: AdminCooperativeDto[]; total: number }> {
  const where = {
    ...(filters.id ? { id: filters.id } : {}),
    ...(filters.status ? { status: filters.status as 'ACTIVE' } : {}),
    ...(filters.typeKey ? { type: { key: filters.typeKey } } : {}),
    ...(filters.includeDemo === 'false' ? { isDemo: false } : {}),
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: 'insensitive' as const } },
            { code: { contains: filters.q, mode: 'insensitive' as const } },
            { district: { contains: filters.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.cooperative.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        isDemo: true,
        province: true,
        district: true,
        registrationNumber: true,
        createdAt: true,
        type: { select: { key: true } },
        _count: { select: { staff: true } },
        staff: { where: { status: 'ACTIVE' }, select: { id: true } },
      },
      orderBy: { name: 'asc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.cooperative.count({ where }),
  ])

  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      typeKey: row.type.key,
      status: row.status,
      isDemo: row.isDemo,
      province: row.province,
      district: row.district,
      registrationNumber: row.registrationNumber,
      staffCount: row._count.staff,
      activeStaffCount: row.staff.length,
      createdAt: row.createdAt.toISOString(),
    })),
  }
}

type CreateCooperativeInput = z.infer<typeof createCooperativeSchema>

export interface CreateCooperativeResult {
  cooperative: AdminCooperativeDto
  manager: { userId: string; email: string; accountCreated: boolean }
}

/**
 * Creates a cooperative and its first manager in one transaction. Either both exist or neither
 * does: a cooperative with no manager cannot be administered, and an orphaned manager row would
 * be a membership of nothing.
 */
/**
 * The prefix a cooperative's member codes start with, taken from its own code so that the first
 * card printed reads `ABAHUZA-00001` rather than `COOP-00001` — which is what the column's default
 * gave every cooperative until the Phase 17 end-to-end run read a new cooperative's first member
 * back. A code may be longer than the twelve characters the settings form allows for a prefix, so
 * it is cut to fit, never ending on a hyphen. The cooperative can change it in its settings.
 */
export function memberCodePrefixFrom(code: string): string {
  return code.slice(0, 12).replace(/-+$/, '')
}

export async function createCooperative(
  ctx: RequestContext,
  input: CreateCooperativeInput,
): Promise<CreateCooperativeResult> {
  const type = await prisma.cooperativeType.findFirst({
    where: { key: input.typeKey, isActive: true },
    select: { id: true },
  })
  if (!type) {
    throw AppError.validationFailed([
      { field: 'body.typeKey', messageKey: 'validation.invalid_value' },
    ])
  }

  const managerRole = await prisma.role.findFirstOrThrow({
    where: { key: 'MANAGER' },
    select: { id: true },
  })

  const settings = await getSystemSettings()
  const existingUser = await prisma.user.findUnique({
    where: { email: input.manager.email },
    select: { id: true, status: true },
  })
  if (existingUser && existingUser.status !== 'ACTIVE') {
    throw AppError.conflict(
      'errors.admin.managerSuspended',
      'That account is suspended. Restore it before making them a manager.',
    )
  }

  const created = await prisma.$transaction(async (tx) => {
    const cooperative = await tx.cooperative
      .create({
        data: {
          code: input.code,
          name: input.name,
          typeId: type.id,
          registrationNumber: input.registrationNumber ?? null,
          province: input.province,
          district: input.district,
          sector: input.sector,
          cell: input.cell,
          village: input.village,
          defaultLocale: input.defaultLocale ?? settings.defaultCooperativeLocale,
          memberCodePrefix: memberCodePrefixFrom(input.code),
        },
        select: { id: true },
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error, 'code')) {
          throw AppError.duplicate('errors.admin.cooperativeCodeTaken')
        }
        if (isUniqueViolation(error, 'registration_number')) {
          throw AppError.duplicate('errors.cooperative.registrationNumberTaken')
        }
        throw error
      })

    let userId = existingUser?.id
    if (!userId) {
      // Unusable until the reset link is followed, so creating a cooperative never mints a
      // guessable credential.
      const unusable = randomBytes(48).toString('base64url')
      const user = await tx.user.create({
        data: {
          email: input.manager.email,
          fullName: input.manager.fullName,
          passwordHash: await hashPassword(unusable),
          mustChangePassword: true,
          locale: input.defaultLocale ?? settings.defaultCooperativeLocale,
        },
        select: { id: true },
      })
      userId = user.id
    }

    await tx.cooperativeStaff.create({
      data: {
        cooperativeId: cooperative.id,
        userId,
        roleId: managerRole.id,
        status: 'ACTIVE',
        invitedById: ctx.user.id,
        joinedAt: existingUser ? new Date() : null,
      },
    })

    // The categories the cooperative starts with, chosen for what it does. A treasurer opening
    // the finance screen on the first morning should be able to record what came in, not stop to
    // invent a filing system; and a contribution cannot be posted at all until at least one
    // income category exists.
    await seedFinanceCategories(tx, cooperative.id, input.typeKey)

    return { cooperativeId: cooperative.id, userId, accountCreated: !existingUser }
  })

  // Without this the manager account exists with a random password nobody knows, and the
  // cooperative cannot be administered by anyone.
  if (created.accountCreated) await issuePasswordSetupLink(created.userId)

  await writeAudit(
    { ctx },
    {
      action: 'platform.cooperative.created',
      entityType: 'Cooperative',
      entityId: created.cooperativeId,
      messageKey: 'audit.platform.cooperativeCreated',
      messageParams: { cooperative: input.name, code: input.code },
      after: { code: input.code, name: input.name, typeKey: input.typeKey },
      cooperativeId: created.cooperativeId,
    },
  )

  return {
    cooperative: await cooperativeById(created.cooperativeId),
    manager: {
      userId: created.userId,
      email: input.manager.email,
      accountCreated: created.accountCreated,
    },
  }
}

type UpdateCooperativeStatusInput = z.infer<typeof updateCooperativeStatusSchema>

/**
 * Suspending a cooperative ends its staff sessions, because "suspended" that still serves requests
 * until tokens expire is not suspended. Archiving is the strongest state and is refused while the
 * cooperative still has active staff, so nobody's access disappears without a decision being made
 * about them first.
 */
export async function updateCooperative(
  ctx: RequestContext,
  cooperativeId: string,
  input: UpdateCooperativeStatusInput,
): Promise<AdminCooperativeDto> {
  const before = await prisma.cooperative.findFirst({
    where: { id: cooperativeId },
    select: { id: true, code: true, name: true, status: true },
  })
  if (!before) throw AppError.notFound()

  if (input.status === 'ARCHIVED' && before.status !== 'ARCHIVED') {
    const activeStaff = await prisma.cooperativeStaff.count({
      where: { cooperativeId, status: 'ACTIVE' },
    })
    if (activeStaff > 0) {
      throw AppError.conflict(
        'errors.admin.archiveHasStaff',
        'Deactivate the remaining staff before archiving this cooperative.',
      )
    }
  }

  await prisma.cooperative.update({
    where: { id: cooperativeId },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.name ? { name: input.name } : {}),
    },
  })

  if (input.status && input.status !== 'ACTIVE' && before.status === 'ACTIVE') {
    const staff = await prisma.cooperativeStaff.findMany({
      where: { cooperativeId },
      select: { userId: true },
    })
    const userIds = staff.map((row) => row.userId)
    if (userIds.length > 0) {
      await prisma.refreshSession.updateMany({
        where: { userId: { in: userIds }, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    }
  }

  await writeAudit(
    { ctx },
    {
      action: 'platform.cooperative.updated',
      entityType: 'Cooperative',
      entityId: cooperativeId,
      messageKey: 'audit.platform.cooperativeUpdated',
      messageParams: { cooperative: before.name },
      before: { status: before.status, name: before.name },
      after: {
        status: input.status ?? before.status,
        name: input.name ?? before.name,
        reason: input.reason ?? null,
      },
      cooperativeId,
    },
  )

  return cooperativeById(cooperativeId)
}

export interface AdminUserDto {
  id: string
  email: string
  fullName: string
  status: string
  isPlatformAdmin: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  lockedUntil: string | null
  memberships: { cooperativeId: string; cooperativeName: string; roleKey: string; status: string }[]
  createdAt: string
}

/** Reads one user by id. Exact, for the same reason as `cooperativeById`. */
async function userById(id: string): Promise<AdminUserDto> {
  const { items } = await listUsers({ id, page: 1, pageSize: 1 })
  const dto = items[0]
  if (!dto) throw AppError.notFound()
  return dto
}

export async function listUsers(filters: {
  id?: string
  q?: string
  status?: string
  platformAdmin?: 'true' | 'false'
  page: number
  pageSize: number
}): Promise<{ items: AdminUserDto[]; total: number }> {
  const where = {
    ...(filters.id ? { id: filters.id } : {}),
    ...(filters.status ? { status: filters.status as 'ACTIVE' } : {}),
    ...(filters.platformAdmin ? { isPlatformAdmin: filters.platformAdmin === 'true' } : {}),
    ...(filters.q
      ? {
          OR: [
            { fullName: { contains: filters.q, mode: 'insensitive' as const } },
            { email: { contains: filters.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        isPlatformAdmin: true,
        mustChangePassword: true,
        lastLoginAt: true,
        lockedUntil: true,
        createdAt: true,
        staff: {
          select: {
            status: true,
            role: { select: { key: true } },
            cooperative: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { fullName: 'asc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.user.count({ where }),
  ])

  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      status: row.status,
      isPlatformAdmin: row.isPlatformAdmin,
      mustChangePassword: row.mustChangePassword,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      lockedUntil: row.lockedUntil?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      memberships: row.staff.map((entry) => ({
        cooperativeId: entry.cooperative.id,
        cooperativeName: entry.cooperative.name,
        roleKey: entry.role.key,
        status: entry.status,
      })),
    })),
  }
}

type CreateUserInput = z.infer<typeof createUserSchema>

export async function createUser(
  ctx: RequestContext,
  input: CreateUserInput,
): Promise<AdminUserDto> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  })
  if (existing) throw AppError.duplicate('errors.admin.emailTaken')

  const unusable = randomBytes(48).toString('base64url')
  const created = await prisma.user.create({
    data: {
      email: input.email,
      fullName: input.fullName,
      passwordHash: await hashPassword(unusable),
      isPlatformAdmin: input.isPlatformAdmin,
      mustChangePassword: true,
      ...(input.locale ? { locale: input.locale } : {}),
    },
    select: { id: true, email: true },
  })

  await issuePasswordSetupLink(created.id)

  await writeAudit(
    { ctx },
    {
      action: 'platform.user.created',
      entityType: 'User',
      entityId: created.id,
      messageKey: 'audit.platform.userCreated',
      messageParams: { user: input.email },
      after: { email: input.email, isPlatformAdmin: input.isPlatformAdmin },
      cooperativeId: null,
    },
  )

  return userById(created.id)
}

type UpdateUserInput = z.infer<typeof updateUserSchema>

/**
 * A platform administrator cannot suspend themselves or drop their own platform flag. Either would
 * be a one-click way to leave the platform with no administrator at all, and the same "ask a
 * colleague" rule that governs cooperative staff applies here for the same reason.
 */
export async function updateUser(
  ctx: RequestContext,
  userId: string,
  input: UpdateUserInput,
): Promise<AdminUserDto> {
  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true, status: true, isPlatformAdmin: true },
  })
  if (!before) throw AppError.notFound()

  const changesAccess = input.status !== undefined || input.isPlatformAdmin !== undefined
  if (changesAccess && userId === ctx.user.id) {
    throw AppError.conflict(
      'errors.admin.notSelf',
      'You cannot change your own access. Ask another platform administrator.',
    )
  }

  if (input.isPlatformAdmin === false && before.isPlatformAdmin) {
    const otherAdmins = await prisma.user.count({
      where: { isPlatformAdmin: true, status: 'ACTIVE', id: { not: userId } },
    })
    if (otherAdmins === 0) {
      throw AppError.conflict(
        'errors.admin.lastPlatformAdmin',
        'This is the only platform administrator. Appoint another one first.',
      )
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.isPlatformAdmin !== undefined ? { isPlatformAdmin: input.isPlatformAdmin } : {}),
    },
  })

  // Suspension must take effect now, not whenever the access token happens to expire.
  if (input.status === 'SUSPENDED' && before.status === 'ACTIVE') {
    await prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  await writeAudit(
    { ctx },
    {
      action: 'platform.user.updated',
      entityType: 'User',
      entityId: userId,
      messageKey: 'audit.platform.userUpdated',
      messageParams: { user: before.email },
      before: {
        fullName: before.fullName,
        status: before.status,
        isPlatformAdmin: before.isPlatformAdmin,
      },
      after: {
        fullName: input.fullName ?? before.fullName,
        status: input.status ?? before.status,
        isPlatformAdmin: input.isPlatformAdmin ?? before.isPlatformAdmin,
        reason: input.reason ?? null,
      },
      cooperativeId: null,
    },
  )

  return userById(userId)
}

export async function getSystemSettings(): Promise<SystemSettings> {
  const rows = await prisma.systemSetting.findMany({ select: { key: true, value: true } })
  const settings: SystemSettings = { ...SYSTEM_SETTING_DEFAULTS }
  for (const row of rows) {
    const validator = SYSTEM_SETTING_VALIDATORS[row.key as SystemSettingKey]
    if (!validator) continue
    const parsed = validator.safeParse(row.value)
    if (parsed.success) Object.assign(settings, { [row.key]: parsed.data })
  }
  return settings
}

export async function putSystemSetting(
  ctx: RequestContext,
  key: SystemSettingKey,
  rawValue: unknown,
): Promise<SystemSettings> {
  const validator = SYSTEM_SETTING_VALIDATORS[key]
  const parsed = validator.safeParse(rawValue)
  if (!parsed.success) {
    throw AppError.validationFailed(
      parsed.error.issues.map((issue) => ({
        field: ['value', ...issue.path.map(String)].join('.'),
        messageKey: `validation.${issue.code}`,
        messageParams: { detail: issue.message },
      })),
    )
  }

  const before = await getSystemSettings()
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: parsed.data, updatedById: ctx.user.id },
    update: { value: parsed.data, updatedById: ctx.user.id },
  })
  const after = await getSystemSettings()

  await writeAudit(
    { ctx },
    {
      action: 'platform.setting.updated',
      entityType: 'SystemSetting',
      entityId: key,
      messageKey: 'audit.platform.settingUpdated',
      messageParams: { key },
      before: { [key]: before[key] },
      after: { [key]: after[key] },
      cooperativeId: null,
    },
  )
  return after
}

export interface PlatformHealthDto {
  database: { reachable: boolean; latencyMs: number | null }
  counts: {
    cooperatives: number
    activeCooperatives: number
    users: number
    activeUsers: number
    platformAdmins: number
  }
  timestamp: string
}

/**
 * The detailed health view, behind `platform:health:view`. The public probes stay deliberately
 * bare; these figures are for an operator who is already authenticated as one.
 */
export async function platformHealth(): Promise<PlatformHealthDto> {
  const [database, cooperatives, activeCooperatives, users, activeUsers, platformAdmins] =
    await Promise.all([
      checkDatabase(),
      prisma.cooperative.count(),
      prisma.cooperative.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count(),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({ where: { isPlatformAdmin: true, status: 'ACTIVE' } }),
    ])

  return {
    database: { reachable: database.reachable, latencyMs: database.latencyMs },
    counts: { cooperatives, activeCooperatives, users, activeUsers, platformAdmins },
    timestamp: new Date().toISOString(),
  }
}
