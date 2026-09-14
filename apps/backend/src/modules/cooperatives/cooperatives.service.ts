import {
  COOPERATIVE_SETTING_DEFAULTS,
  type CooperativeSettingKey,
  type CooperativeSettings,
  type Locale,
  type RoleKey,
} from '@coopmanage/shared'
import type { RequestContext } from '../../lib/context.js'
import { writeAudit } from '../../lib/audit.js'
import { isUniqueViolation } from '../../lib/dbErrors.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import {
  COOPERATIVE_SETTING_VALIDATORS,
  type UpdateCooperativeInput,
} from './cooperatives.schemas.js'

export interface MembershipDto {
  cooperativeId: string
  name: string
  code: string
  typeKey: string
  roleKey: RoleKey
  isDemo: boolean
  status: 'ACTIVE' | 'SUSPENDED'
}

/**
 * The cooperatives the caller may act in, which is what the switcher in the top bar is built
 * from. Scoped to the caller's own ACTIVE memberships, so it is never a directory of the platform.
 *
 * A platform administrator deliberately gets the same answer: their own memberships, which is
 * usually none. Listing every cooperative is a separate, audited platform endpoint, and conflating
 * the two would put the whole platform in an ordinary user's switcher.
 */
export async function listMyCooperatives(userId: string): Promise<MembershipDto[]> {
  const rows = await prisma.cooperativeStaff.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      cooperative: { status: { not: 'ARCHIVED' } },
    },
    select: {
      role: { select: { key: true } },
      cooperative: {
        select: {
          id: true,
          name: true,
          code: true,
          isDemo: true,
          status: true,
          type: { select: { key: true } },
        },
      },
    },
    orderBy: { cooperative: { name: 'asc' } },
  })

  return rows.map((row) => ({
    cooperativeId: row.cooperative.id,
    name: row.cooperative.name,
    code: row.cooperative.code,
    typeKey: row.cooperative.type.key,
    roleKey: row.role.key as RoleKey,
    isDemo: row.cooperative.isDemo,
    status: row.cooperative.status as 'ACTIVE' | 'SUSPENDED',
  }))
}

export interface CooperativeProfileDto {
  id: string
  code: string
  name: string
  type: { key: string; nameEn: string; nameRw: string }
  registrationNumber: string | null
  tinNumber: string | null
  province: string
  district: string
  sector: string
  cell: string
  village: string
  addressLine: string | null
  phone: string | null
  email: string | null
  logoUrl: string | null
  foundedOn: string | null
  status: string
  isDemo: boolean
  currency: string
  timezone: string
  defaultLocale: Locale
  memberCodePrefix: string
  fiscalYearStartMonth: number
  createdAt: string
}

/**
 * Always scoped by the resolved cooperative id, never by an id from the request body. Every read
 * in this module follows that rule, which is the third of the four tenancy layers.
 */
export async function getCooperativeProfile(cooperativeId: string): Promise<CooperativeProfileDto> {
  const row = await prisma.cooperative.findFirst({
    where: { id: cooperativeId },
    select: {
      id: true,
      code: true,
      name: true,
      registrationNumber: true,
      tinNumber: true,
      province: true,
      district: true,
      sector: true,
      cell: true,
      village: true,
      addressLine: true,
      phone: true,
      email: true,
      logoUrl: true,
      foundedOn: true,
      status: true,
      isDemo: true,
      currency: true,
      timezone: true,
      defaultLocale: true,
      memberCodePrefix: true,
      fiscalYearStartMonth: true,
      createdAt: true,
      type: { select: { key: true, nameEn: true, nameRw: true } },
    },
  })
  if (!row) throw AppError.notFound()

  return {
    ...row,
    foundedOn: row.foundedOn ? row.foundedOn.toISOString().slice(0, 10) : null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Fields whose previous and new values are worth keeping in the trail. */
const AUDITED_FIELDS = [
  'name',
  'registrationNumber',
  'tinNumber',
  'province',
  'district',
  'sector',
  'cell',
  'village',
  'addressLine',
  'phone',
  'email',
  'foundedOn',
  'defaultLocale',
  'memberCodePrefix',
  'fiscalYearStartMonth',
] as const

export async function updateCooperativeProfile(
  ctx: RequestContext,
  input: UpdateCooperativeInput,
): Promise<CooperativeProfileDto> {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw AppError.noCooperativeAccess()

  const before = await getCooperativeProfile(cooperativeId)

  const data: Record<string, unknown> = { ...input }
  if (input.foundedOn !== undefined) {
    data.foundedOn = input.foundedOn === null ? null : new Date(`${input.foundedOn}T00:00:00Z`)
  }

  try {
    await prisma.cooperative.update({ where: { id: cooperativeId }, data })
  } catch (error) {
    // registration_number is unique platform-wide, so a clash is with another cooperative's
    // record. The message must not say whose.
    if (isUniqueViolation(error, 'registration_number')) {
      throw AppError.duplicate('errors.cooperative.registrationNumberTaken')
    }
    throw error
  }

  const after = await getCooperativeProfile(cooperativeId)

  const changed = AUDITED_FIELDS.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  )
  if (changed.length > 0) {
    await writeAudit(
      { ctx },
      {
        action: 'cooperative.updated',
        entityType: 'Cooperative',
        entityId: cooperativeId,
        messageKey: 'audit.cooperative.updated',
        messageParams: { fields: changed.join(', ') },
        before: Object.fromEntries(changed.map((field) => [field, before[field]])),
        after: Object.fromEntries(changed.map((field) => [field, after[field]])),
      },
    )
  }

  return after
}

/**
 * Settings are returned as a complete object with defaults filled in, never as the sparse set of
 * rows that happen to exist. A screen reading a setting must not have to know whether anyone has
 * ever saved it.
 */
export async function getCooperativeSettings(cooperativeId: string): Promise<CooperativeSettings> {
  const rows = await prisma.cooperativeSetting.findMany({
    where: { cooperativeId },
    select: { key: true, value: true },
  })

  const settings: CooperativeSettings = { ...COOPERATIVE_SETTING_DEFAULTS }
  for (const row of rows) {
    const validator = COOPERATIVE_SETTING_VALIDATORS[row.key as CooperativeSettingKey]
    if (!validator) continue
    const parsed = validator.safeParse(row.value)
    // A stored value that no longer fits its validator falls back to the default rather than
    // breaking every screen that reads it. This can only happen after a catalogue change.
    if (parsed.success) {
      Object.assign(settings, { [row.key]: parsed.data })
    }
  }
  return settings
}

export async function putCooperativeSetting(
  ctx: RequestContext,
  key: CooperativeSettingKey,
  rawValue: unknown,
): Promise<CooperativeSettings> {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw AppError.noCooperativeAccess()

  const validator = COOPERATIVE_SETTING_VALIDATORS[key]
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

  const before = await getCooperativeSettings(cooperativeId)

  await prisma.cooperativeSetting.upsert({
    where: { cooperativeId_key: { cooperativeId, key } },
    create: { cooperativeId, key, value: parsed.data, updatedById: ctx.user.id },
    update: { value: parsed.data, updatedById: ctx.user.id },
  })

  const after = await getCooperativeSettings(cooperativeId)

  await writeAudit(
    { ctx },
    {
      action: 'cooperative.setting.updated',
      entityType: 'CooperativeSetting',
      entityId: cooperativeId,
      messageKey: 'audit.cooperative.settingUpdated',
      messageParams: { key },
      before: { [key]: before[key] },
      after: { [key]: after[key] },
    },
  )

  return after
}
