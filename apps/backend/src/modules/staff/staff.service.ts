import { randomBytes } from 'node:crypto'
import type { PermissionKey, RoleKey } from '@coopmanage/shared'
import { writeAudit } from '../../lib/audit.js'
import type { RequestContext } from '../../lib/context.js'
import { AppError } from '../../lib/errors.js'
import { hashPassword } from '../../lib/password.js'
import { prisma } from '../../lib/prisma.js'
import { issuePasswordSetupLink } from '../auth/passwordSetup.js'
import { invalidateStaffPermissions } from '../auth/permissions.service.js'

export interface StaffDto {
  id: string
  user: { id: string; email: string; fullName: string; status: string; lastLoginAt: string | null }
  roleKey: RoleKey
  roleName: { en: string; rw: string }
  jobTitle: string | null
  status: 'ACTIVE' | 'INACTIVE'
  invitedAt: string
  joinedAt: string | null
  deactivatedAt: string | null
  /** Present so the interface can mark the row as the caller's own and disable its controls. */
  isSelf: boolean
  overrideCount: number
}

const STAFF_SELECT = {
  id: true,
  jobTitle: true,
  status: true,
  invitedAt: true,
  joinedAt: true,
  deactivatedAt: true,
  role: { select: { key: true, nameEn: true, nameRw: true } },
  user: { select: { id: true, email: true, fullName: true, status: true, lastLoginAt: true } },
  _count: { select: { overrides: true } },
} as const

type StaffRow = {
  id: string
  jobTitle: string | null
  status: string
  invitedAt: Date
  joinedAt: Date | null
  deactivatedAt: Date | null
  role: { key: string; nameEn: string; nameRw: string }
  user: {
    id: string
    email: string
    fullName: string
    status: string
    lastLoginAt: Date | null
  }
  _count: { overrides: number }
}

function toDto(row: StaffRow, ctx: RequestContext): StaffDto {
  return {
    id: row.id,
    user: {
      id: row.user.id,
      email: row.user.email,
      fullName: row.user.fullName,
      status: row.user.status,
      lastLoginAt: row.user.lastLoginAt?.toISOString() ?? null,
    },
    roleKey: row.role.key as RoleKey,
    roleName: { en: row.role.nameEn, rw: row.role.nameRw },
    jobTitle: row.jobTitle,
    status: row.status as 'ACTIVE' | 'INACTIVE',
    invitedAt: row.invitedAt.toISOString(),
    joinedAt: row.joinedAt?.toISOString() ?? null,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    isSelf: row.user.id === ctx.user.id,
    overrideCount: row._count.overrides,
  }
}

export async function listStaff(
  ctx: RequestContext,
  filters: { status?: 'ACTIVE' | 'INACTIVE'; roleKey?: string },
): Promise<StaffDto[]> {
  const cooperativeId = requireCooperative(ctx)
  const rows = await prisma.cooperativeStaff.findMany({
    where: {
      cooperativeId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.roleKey ? { role: { key: filters.roleKey } } : {}),
    },
    select: STAFF_SELECT,
    orderBy: [{ status: 'asc' }, { user: { fullName: 'asc' } }],
  })
  return rows.map((row) => toDto(row, ctx))
}

/**
 * Loading one staff row. Always filtered by the resolved cooperative as well as the id, and a row
 * belonging to another cooperative answers "not found" rather than "forbidden", so identifiers
 * cannot be probed.
 */
async function findStaffOrThrow(cooperativeId: string, staffId: string): Promise<StaffRow> {
  const row = await prisma.cooperativeStaff.findFirst({
    where: { id: staffId, cooperativeId },
    select: STAFF_SELECT,
  })
  if (!row) throw AppError.notFound()
  return row
}

function requireCooperative(ctx: RequestContext): string {
  const id = ctx.cooperative?.id
  if (!id) throw AppError.noCooperativeAccess()
  return id
}

/**
 * A cooperative must never be left without someone who can administer it. Both the role change
 * and the deactivation paths run this check, because either one can remove the last manager and
 * lock every remaining member of staff out of settings, invitations and roles.
 */
async function assertNotLastManager(
  cooperativeId: string,
  staffId: string,
  currentRoleKey: string,
): Promise<void> {
  if (currentRoleKey !== 'MANAGER') return
  const otherActiveManagers = await prisma.cooperativeStaff.count({
    where: {
      cooperativeId,
      status: 'ACTIVE',
      role: { key: 'MANAGER' },
      id: { not: staffId },
    },
  })
  if (otherActiveManagers === 0) {
    throw AppError.conflict(
      'errors.staff.lastManager',
      'This is the only active manager. Appoint another manager first.',
    )
  }
}

/**
 * Changing your own role or status is refused. It is the shortest route to a cooperative with no
 * manager, and self-promotion is the thing a role system exists to prevent. Another manager makes
 * the change, and the audit trail then names two different people.
 */
function assertNotSelf(row: StaffRow, ctx: RequestContext): void {
  if (row.user.id === ctx.user.id) {
    throw AppError.conflict(
      'errors.staff.notSelf',
      'You cannot change your own role or status. Ask another manager to do it.',
    )
  }
}

export interface InviteStaffInput {
  email: string
  fullName: string
  roleKey: string
  jobTitle?: string | null
}

export interface InviteStaffResult {
  staff: StaffDto
  /** True when this invitation created the user account, so the interface can say what happens next. */
  accountCreated: boolean
}

/**
 * Invites a member of staff.
 *
 * If the address already has an account the person is linked to this cooperative; otherwise an
 * account is created with an unusable random password and a reset link, which is how they choose
 * their own. Either way they receive a password-reset delivery, so there is no invitation token to
 * maintain as a second credential type.
 *
 * A note on what this discloses: a manager who invites an address that already has an account
 * learns that it exists, and sees the name on it. That is inherent to linking an existing person
 * rather than creating a duplicate account, it is how comparable systems behave, and `staff:invite`
 * is held only by a manager. It is recorded here as a deliberate trade-off rather than an oversight.
 */
export async function inviteStaff(
  ctx: RequestContext,
  input: InviteStaffInput,
): Promise<InviteStaffResult> {
  const cooperativeId = requireCooperative(ctx)

  const role = await prisma.role.findFirst({
    where: { key: input.roleKey, scope: 'COOPERATIVE' },
    select: { id: true, key: true },
  })
  if (!role)
    throw AppError.validationFailed([
      { field: 'body.roleKey', messageKey: 'validation.invalid_value' },
    ])

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, status: true },
  })

  let userId: string
  let accountCreated = false

  if (existing) {
    if (existing.status !== 'ACTIVE') {
      throw AppError.conflict(
        'errors.staff.accountSuspended',
        'That account is suspended. A platform administrator must restore it first.',
      )
    }
    userId = existing.id

    const already = await prisma.cooperativeStaff.findUnique({
      where: { cooperativeId_userId: { cooperativeId, userId } },
      select: { id: true, status: true },
    })
    if (already?.status === 'ACTIVE') {
      throw AppError.duplicate('errors.staff.alreadyMember')
    }
    if (already) {
      // Reactivating rather than inserting: the unique constraint on (cooperative, user) means a
      // previously deactivated person is re-invited, not duplicated, and their history is kept.
      await prisma.cooperativeStaff.update({
        where: { id: already.id },
        data: {
          roleId: role.id,
          jobTitle: input.jobTitle ?? null,
          status: 'ACTIVE',
          deactivatedAt: null,
          invitedById: ctx.user.id,
          invitedAt: new Date(),
        },
      })
      invalidateStaffPermissions(already.id)
      const row = await findStaffOrThrow(cooperativeId, already.id)
      await auditInvite(ctx, row, { reactivated: true })
      return { staff: toDto(row, ctx), accountCreated: false }
    }
  } else {
    // A password that nobody knows, including us. The account is unusable until the reset link is
    // followed, so an invitation never creates a guessable credential.
    const unusable = randomBytes(48).toString('base64url')
    const created = await prisma.user.create({
      data: {
        email: input.email,
        fullName: input.fullName,
        passwordHash: await hashPassword(unusable),
        mustChangePassword: true,
      },
      select: { id: true },
    })
    userId = created.id
    accountCreated = true
  }

  const staff = await prisma.cooperativeStaff.create({
    data: {
      cooperativeId,
      userId,
      roleId: role.id,
      jobTitle: input.jobTitle ?? null,
      status: 'ACTIVE',
      invitedById: ctx.user.id,
    },
    select: { id: true },
  })

  await issuePasswordSetupLink(userId)

  const row = await findStaffOrThrow(cooperativeId, staff.id)
  await auditInvite(ctx, row, { reactivated: false })
  return { staff: toDto(row, ctx), accountCreated }
}

async function auditInvite(
  ctx: RequestContext,
  row: StaffRow,
  options: { reactivated: boolean },
): Promise<void> {
  await writeAudit(
    { ctx },
    {
      action: options.reactivated ? 'staff.reactivated' : 'staff.invited',
      entityType: 'CooperativeStaff',
      entityId: row.id,
      messageKey: options.reactivated ? 'audit.staff.reactivated' : 'audit.staff.invited',
      messageParams: { staff: row.user.fullName, role: row.role.key },
      after: { email: row.user.email, roleKey: row.role.key, jobTitle: row.jobTitle },
    },
  )
}

export interface UpdateStaffInput {
  roleKey?: string
  jobTitle?: string | null
  status?: 'ACTIVE' | 'INACTIVE'
}

export async function updateStaff(
  ctx: RequestContext,
  staffId: string,
  input: UpdateStaffInput,
): Promise<StaffDto> {
  const cooperativeId = requireCooperative(ctx)
  const row = await findStaffOrThrow(cooperativeId, staffId)

  const changesRoleOrStatus = input.roleKey !== undefined || input.status !== undefined
  if (changesRoleOrStatus) assertNotSelf(row, ctx)

  const data: Record<string, unknown> = {}

  if (input.roleKey !== undefined && input.roleKey !== row.role.key) {
    await assertNotLastManager(cooperativeId, staffId, row.role.key)
    const role = await prisma.role.findFirst({
      where: { key: input.roleKey, scope: 'COOPERATIVE' },
      select: { id: true },
    })
    if (!role) {
      throw AppError.validationFailed([
        { field: 'body.roleKey', messageKey: 'validation.invalid_value' },
      ])
    }
    data.roleId = role.id
  }

  if (input.jobTitle !== undefined) data.jobTitle = input.jobTitle

  if (input.status !== undefined && input.status !== row.status) {
    if (input.status === 'INACTIVE') {
      await assertNotLastManager(cooperativeId, staffId, row.role.key)
      data.status = 'INACTIVE'
      data.deactivatedAt = new Date()
    } else {
      data.status = 'ACTIVE'
      data.deactivatedAt = null
    }
  }

  if (Object.keys(data).length === 0) return toDto(row, ctx)

  await prisma.cooperativeStaff.update({ where: { id: staffId }, data })
  invalidateStaffPermissions(staffId)

  const after = await findStaffOrThrow(cooperativeId, staffId)
  await writeAudit(
    { ctx },
    {
      action: 'staff.updated',
      entityType: 'CooperativeStaff',
      entityId: staffId,
      messageKey: 'audit.staff.updated',
      messageParams: { staff: after.user.fullName },
      before: { roleKey: row.role.key, jobTitle: row.jobTitle, status: row.status },
      after: { roleKey: after.role.key, jobTitle: after.jobTitle, status: after.status },
    },
  )
  return toDto(after, ctx)
}

/**
 * Deactivation, not deletion. The staff row carries who invited whom and when, and it is the link
 * every audit entry points at; removing it would make the trail unreadable. Their sessions are
 * revoked so the change takes effect immediately rather than at the next token expiry.
 */
export async function deactivateStaff(
  ctx: RequestContext,
  staffId: string,
  reason: string | null,
): Promise<StaffDto> {
  const cooperativeId = requireCooperative(ctx)
  const row = await findStaffOrThrow(cooperativeId, staffId)

  assertNotSelf(row, ctx)
  if (row.status === 'INACTIVE') return toDto(row, ctx)
  await assertNotLastManager(cooperativeId, staffId, row.role.key)

  await prisma.cooperativeStaff.update({
    where: { id: staffId },
    data: { status: 'INACTIVE', deactivatedAt: new Date() },
  })
  invalidateStaffPermissions(staffId)

  // If this was their only cooperative they have nothing left to reach, so their sessions end.
  // Someone who serves another cooperative keeps their session and simply loses this tenant.
  const remaining = await prisma.cooperativeStaff.count({
    where: { userId: row.user.id, status: 'ACTIVE' },
  })
  if (remaining === 0) {
    await prisma.refreshSession.updateMany({
      where: { userId: row.user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  const after = await findStaffOrThrow(cooperativeId, staffId)
  await writeAudit(
    { ctx },
    {
      action: 'staff.deactivated',
      entityType: 'CooperativeStaff',
      entityId: staffId,
      messageKey: 'audit.staff.deactivated',
      messageParams: { staff: after.user.fullName },
      before: { status: row.status },
      after: { status: after.status, reason },
    },
  )
  return toDto(after, ctx)
}

export interface OverrideDto {
  permission: PermissionKey
  effect: 'GRANT' | 'DENY'
  reason: string | null
  grantedBy: string | null
  createdAt: string
}

export async function listOverrides(
  ctx: RequestContext,
  staffId: string,
): Promise<{ staff: StaffDto; overrides: OverrideDto[] }> {
  const cooperativeId = requireCooperative(ctx)
  const row = await findStaffOrThrow(cooperativeId, staffId)

  const overrides = await prisma.staffPermissionOverride.findMany({
    where: { staffId },
    select: {
      effect: true,
      reason: true,
      createdAt: true,
      permission: { select: { key: true } },
      grantedBy: { select: { fullName: true } },
    },
    orderBy: { permission: { key: 'asc' } },
  })

  return {
    staff: toDto(row, ctx),
    overrides: overrides.map((override) => ({
      permission: override.permission.key as PermissionKey,
      effect: override.effect,
      reason: override.reason,
      grantedBy: override.grantedBy?.fullName ?? null,
      createdAt: override.createdAt.toISOString(),
    })),
  }
}

export interface PutOverridesInput {
  overrides: { permission: string; effect: 'GRANT' | 'DENY'; reason?: string | null }[]
}

/**
 * Replaces the whole exception list in one transaction. Sending the complete intended set, rather
 * than patching one permission at a time, means two administrators editing at once cannot merge
 * into a combination neither of them chose.
 */
export async function putOverrides(
  ctx: RequestContext,
  staffId: string,
  input: PutOverridesInput,
): Promise<{ staff: StaffDto; overrides: OverrideDto[] }> {
  const cooperativeId = requireCooperative(ctx)
  const row = await findStaffOrThrow(cooperativeId, staffId)

  const keys = input.overrides.map((override) => override.permission)
  const permissions = await prisma.permission.findMany({
    where: { key: { in: keys }, scope: 'COOPERATIVE' },
    select: { id: true, key: true },
  })
  if (permissions.length !== keys.length) {
    const known = new Set(permissions.map((permission) => permission.key))
    const unknown = keys.filter((key) => !known.has(key))
    throw AppError.validationFailed(
      unknown.map((key) => ({
        field: 'body.overrides',
        messageKey: 'validation.invalid_value',
        messageParams: { detail: key },
      })),
    )
  }
  const idByKey = new Map(permissions.map((permission) => [permission.key, permission.id]))

  const before = await listOverrides(ctx, staffId)

  await prisma.$transaction([
    prisma.staffPermissionOverride.deleteMany({ where: { staffId } }),
    prisma.staffPermissionOverride.createMany({
      data: input.overrides.map((override) => ({
        staffId,
        permissionId: idByKey.get(override.permission) as string,
        effect: override.effect,
        reason: override.reason ?? null,
        grantedById: ctx.user.id,
      })),
    }),
  ])
  invalidateStaffPermissions(staffId)

  const after = await listOverrides(ctx, staffId)
  await writeAudit(
    { ctx },
    {
      action: 'staff.overrides.replaced',
      entityType: 'CooperativeStaff',
      entityId: staffId,
      messageKey: 'audit.staff.overridesReplaced',
      messageParams: { staff: row.user.fullName, count: input.overrides.length },
      before: { overrides: before.overrides.map(describeOverride) },
      after: { overrides: after.overrides.map(describeOverride) },
    },
  )
  return after
}

function describeOverride(override: OverrideDto): string {
  return `${override.effect} ${override.permission}`
}

export interface RoleDto {
  key: RoleKey
  nameEn: string
  nameRw: string
  descriptionEn: string
  descriptionRw: string
  permissions: PermissionKey[]
}

/**
 * The cooperative roles a staff member may hold, with the permissions each carries, so the staff
 * screen can explain what a role means rather than only naming it. `SYSTEM_ADMIN` is excluded: it
 * is a platform role and nothing a cooperative can assign.
 */
export async function listAssignableRoles(): Promise<RoleDto[]> {
  const roles = await prisma.role.findMany({
    where: { scope: 'COOPERATIVE' },
    select: {
      key: true,
      nameEn: true,
      nameRw: true,
      descriptionEn: true,
      descriptionRw: true,
      permissions: { select: { permission: { select: { key: true } } } },
    },
    orderBy: { key: 'asc' },
  })

  return roles.map((role) => ({
    key: role.key as RoleKey,
    nameEn: role.nameEn,
    nameRw: role.nameRw,
    descriptionEn: role.descriptionEn,
    descriptionRw: role.descriptionRw,
    permissions: role.permissions
      .map((entry) => entry.permission.key as PermissionKey)
      .sort((a, b) => a.localeCompare(b)),
  }))
}

export interface PermissionDto {
  key: PermissionKey
  resource: string
  action: string
  descriptionEn: string
  descriptionRw: string
}

/** The cooperative-scope permission catalogue, for the override editor. */
export async function listCooperativePermissions(): Promise<PermissionDto[]> {
  const rows = await prisma.permission.findMany({
    where: { scope: 'COOPERATIVE' },
    select: { key: true, resource: true, action: true, descriptionEn: true, descriptionRw: true },
    orderBy: [{ resource: 'asc' }, { action: 'asc' }],
  })
  return rows.map((row) => ({ ...row, key: row.key as PermissionKey }))
}
