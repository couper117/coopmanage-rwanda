import { randomUUID } from 'node:crypto'
import type { Request } from 'express'
import {
  isRoleKey,
  type AuthUser,
  type LoginResult,
  type Membership,
  type RoleKey,
  type SessionDevice,
  type SessionSummary,
} from '@coopmanage/shared'
import { env } from '../../config/env.js'
import { writeAudit } from '../../lib/audit.js'
import type { RequestContext } from '../../lib/context.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import {
  assertPasswordAcceptable,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../../lib/password.js'
import {
  accessTokenLifetimeSeconds,
  generateOpaqueToken,
  hashToken,
  signAccessToken,
} from '../../lib/tokens.js'
import { deliverPasswordReset } from './auth.delivery.js'
import { invalidateStaffPermissions, staffPermissions } from './permissions.service.js'

/**
 * Everything that decides whether somebody is signed in, and what a session is worth.
 *
 * Two rules run through the whole file. Nothing here ever tells an anonymous caller whether an
 * email address is registered — login, forgot-password and reset all answer identically for a
 * known and an unknown address. And every token is stored only as a hash, so the database holds
 * nothing that can be presented back to the API.
 */

/** Failures tolerated before the account starts locking. */
const LOCKOUT_THRESHOLD = 5
const LOCKOUT_CAP_MINUTES = 60

/**
 * Progressive, not fixed: one minute on the fifth failure, doubling to an hour. A wrong password
 * typed twice costs nothing, while a list of a thousand guesses runs out of time long before it
 * runs out of guesses.
 */
export function lockoutMinutes(failedCount: number): number {
  if (failedCount < LOCKOUT_THRESHOLD) return 0
  const doublings = failedCount - LOCKOUT_THRESHOLD
  return Math.min(LOCKOUT_CAP_MINUTES, 2 ** doublings)
}

const USER_FIELDS = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  locale: true,
  isPlatformAdmin: true,
  mustChangePassword: true,
  lastLoginAt: true,
} as const

type UserRow = {
  id: string
  email: string
  fullName: string
  phone: string | null
  locale: 'EN' | 'RW'
  isPlatformAdmin: boolean
  mustChangePassword: boolean
  lastLoginAt: Date | null
}

function toAuthUser(user: UserRow): AuthUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    locale: user.locale,
    isPlatformAdmin: user.isPlatformAdmin,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  }
}

export async function membershipsFor(userId: string): Promise<Membership[]> {
  const rows = await prisma.cooperativeStaff.findMany({
    where: { userId, status: 'ACTIVE', cooperative: { status: 'ACTIVE' } },
    select: {
      jobTitle: true,
      role: { select: { key: true, nameEn: true, nameRw: true } },
      cooperative: { select: { id: true, name: true, code: true, isDemo: true } },
    },
    orderBy: { cooperative: { name: 'asc' } },
  })

  return rows
    .filter((row): row is typeof row & { role: { key: RoleKey } } => isRoleKey(row.role.key))
    .map((row) => ({
      cooperativeId: row.cooperative.id,
      cooperativeName: row.cooperative.name,
      cooperativeCode: row.cooperative.code,
      isDemo: row.cooperative.isDemo,
      roleKey: row.role.key,
      roleNameEn: row.role.nameEn,
      roleNameRw: row.role.nameRw,
      jobTitle: row.jobTitle,
    }))
}

interface SessionRequest {
  req: Request
  userAgent: string | null
  ipAddress: string | null
}

/** Issues a brand new session family. Rotation reuses the family; a fresh login never does. */
async function startSession(
  userId: string,
  info: SessionRequest,
): Promise<{ token: string; expiresAt: Date; familyId: string }> {
  const token = generateOpaqueToken()
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
  const session = await prisma.refreshSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      familyId: randomUUID(),
      userAgent: info.userAgent,
      ipAddress: info.ipAddress,
      expiresAt,
    },
    select: { familyId: true },
  })
  return { token, expiresAt, familyId: session.familyId }
}

export interface LoginOutcome {
  result: LoginResult
  refreshToken: string
  refreshExpiresAt: Date
}

export async function login(
  input: { email: string; password: string },
  info: SessionRequest,
): Promise<LoginOutcome> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: {
      ...USER_FIELDS,
      passwordHash: true,
      status: true,
      failedLoginCount: true,
      lockedUntil: true,
    },
  })

  // The dummy verify is not wasted work: without it a request for an unknown address would return
  // in a millisecond and a request for a known one in fifty, which is enough to enumerate users.
  const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH
  const passwordMatches = await verifyPassword(hash, input.password)

  if (!user || user.status !== 'ACTIVE') {
    await writeAudit(
      { req: info.req, anonymous: { userId: null, label: input.email } },
      {
        action: 'auth.login.failed',
        entityType: 'User',
        messageKey: 'audit.auth.loginFailed',
        messageParams: { email: input.email },
        cooperativeId: null,
      },
    )
    throw AppError.invalidCredentials()
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000))
    throw AppError.accountLocked(minutes)
  }

  if (!passwordMatches) {
    const failedLoginCount = user.failedLoginCount + 1
    const minutes = lockoutMinutes(failedLoginCount)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount,
        lockedUntil: minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null,
      },
    })
    await writeAudit(
      { req: info.req, anonymous: { userId: user.id, label: `${user.fullName} <${user.email}>` } },
      {
        action: 'auth.login.failed',
        entityType: 'User',
        entityId: user.id,
        messageKey: 'audit.auth.loginFailed',
        messageParams: { email: user.email },
        cooperativeId: null,
      },
    )
    if (minutes > 0) throw AppError.accountLocked(minutes)
    throw AppError.invalidCredentials()
  }

  // A password proven correct against an older, cheaper hash is re-hashed at the current cost.
  // This is the only moment the plain password is available to do it.
  const passwordHash = needsRehash(user.passwordHash)
    ? await hashPassword(input.password)
    : undefined

  const { token, expiresAt, familyId } = await startSession(user.id, info)
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      ...(passwordHash ? { passwordHash } : {}),
    },
    select: USER_FIELDS,
  })

  await writeAudit(
    { req: info.req, anonymous: { userId: user.id, label: `${user.fullName} <${user.email}>` } },
    {
      action: 'auth.login.succeeded',
      entityType: 'User',
      entityId: user.id,
      messageKey: 'audit.auth.loginSucceeded',
      messageParams: { email: user.email },
      cooperativeId: null,
    },
  )

  return {
    result: {
      accessToken: signAccessToken({ sub: user.id, fid: familyId }),
      expiresIn: accessTokenLifetimeSeconds(),
      user: toAuthUser(updated),
      memberships: await membershipsFor(user.id),
    },
    refreshToken: token,
    refreshExpiresAt: expiresAt,
  }
}

export interface RefreshOutcome {
  accessToken: string
  expiresIn: number
  refreshToken: string
  refreshExpiresAt: Date
}

/**
 * Rotation with family revocation. Every refresh mints a new token and marks the old one replaced;
 * presenting a token that has already been replaced means two parties hold the same token, so the
 * whole family is revoked and both are signed out. That is the mechanism that detects theft, and
 * it is why an honest client must never race two refreshes.
 */
export async function refresh(
  presentedToken: string,
  info: SessionRequest,
): Promise<RefreshOutcome> {
  const session = await prisma.refreshSession.findUnique({
    where: { tokenHash: hashToken(presentedToken) },
    select: {
      id: true,
      userId: true,
      familyId: true,
      expiresAt: true,
      revokedAt: true,
      replacedById: true,
      user: { select: { status: true, fullName: true, email: true } },
    },
  })

  if (!session) throw AppError.unauthenticated()

  if (session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') {
    throw AppError.unauthenticated()
  }

  const token = generateOpaqueToken()
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)

  /**
   * The rotation claims the presented token with a conditional update before doing anything else.
   *
   * Checking `replacedById` in the row read above and then acting on it would be a check followed
   * by an act, and two requests carrying the same token would both pass the check, both mint a
   * replacement, and leave two live tokens in one family with the theft undetected. The
   * `UPDATE ... WHERE replaced_by_id IS NULL AND revoked_at IS NULL` takes a row lock, so exactly
   * one caller can win, whatever else is in flight.
   */
  const claimed = await prisma.$transaction(async (tx) => {
    const claim = await tx.refreshSession.updateMany({
      where: { id: session.id, revokedAt: null, replacedById: null },
      data: { revokedAt: new Date() },
    })
    if (claim.count === 0) return false

    const replacement = await tx.refreshSession.create({
      data: {
        userId: session.userId,
        tokenHash: hashToken(token),
        familyId: session.familyId,
        userAgent: info.userAgent,
        ipAddress: info.ipAddress,
        expiresAt,
      },
      select: { id: true },
    })
    await tx.refreshSession.update({
      where: { id: session.id },
      data: { replacedById: replacement.id },
    })
    return true
  })

  if (!claimed) {
    // The token had already been rotated, so two parties hold it. Both are signed out: the point
    // of rotation is that a stolen token is detected rather than tolerated.
    await prisma.refreshSession.updateMany({
      where: { familyId: session.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    await writeAudit(
      {
        req: info.req,
        anonymous: {
          userId: session.userId,
          label: `${session.user.fullName} <${session.user.email}>`,
        },
      },
      {
        action: 'auth.refresh.reused',
        entityType: 'RefreshSession',
        entityId: session.id,
        messageKey: 'audit.auth.refreshReused',
        cooperativeId: null,
      },
    )
    throw AppError.unauthenticated()
  }

  return {
    accessToken: signAccessToken({ sub: session.userId, fid: session.familyId }),
    expiresIn: accessTokenLifetimeSeconds(),
    refreshToken: token,
    refreshExpiresAt: expiresAt,
  }
}

/** Revokes the whole family, so signing out on one device ends that device's chain entirely. */
export async function logout(presentedToken: string | null, req: Request): Promise<void> {
  if (!presentedToken) return
  const session = await prisma.refreshSession.findUnique({
    where: { tokenHash: hashToken(presentedToken) },
    select: {
      familyId: true,
      userId: true,
      user: { select: { fullName: true, email: true } },
    },
  })
  if (!session) return

  await prisma.refreshSession.updateMany({
    where: { familyId: session.familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  await writeAudit(
    {
      req,
      anonymous: {
        userId: session.userId,
        label: `${session.user.fullName} <${session.user.email}>`,
      },
    },
    {
      action: 'auth.logout',
      entityType: 'User',
      entityId: session.userId,
      messageKey: 'audit.auth.logout',
      cooperativeId: null,
    },
  )
}

export async function sessionSummary(ctx: RequestContext): Promise<SessionSummary> {
  const user = await prisma.user.findUnique({ where: { id: ctx.user.id }, select: USER_FIELDS })
  if (!user) throw AppError.unauthenticated()

  return {
    user: toAuthUser(user),
    memberships: await membershipsFor(user.id),
    cooperative: ctx.cooperative
      ? {
          id: ctx.cooperative.id,
          name: ctx.cooperative.name,
          code: ctx.cooperative.code,
          isDemo: ctx.cooperative.isDemo,
        }
      : null,
    roleKey: ctx.staff?.roleKey ?? null,
    permissions: [...ctx.permissions].sort(),
  }
}

export async function updateProfile(
  ctx: RequestContext,
  req: Request,
  input: { fullName?: string; phone?: string | null; locale?: 'EN' | 'RW' },
): Promise<AuthUser> {
  const before = await prisma.user.findUnique({ where: { id: ctx.user.id }, select: USER_FIELDS })
  if (!before) throw AppError.unauthenticated()

  const after = await prisma.user.update({
    where: { id: ctx.user.id },
    data: {
      ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
      ...(input.phone === undefined ? {} : { phone: input.phone }),
      ...(input.locale === undefined ? {} : { locale: input.locale }),
    },
    select: USER_FIELDS,
  })

  await writeAudit(
    { ctx, req },
    {
      action: 'user.profile.updated',
      entityType: 'User',
      entityId: ctx.user.id,
      messageKey: 'audit.user.profileUpdated',
      before: { fullName: before.fullName, phone: before.phone, locale: before.locale },
      after: { fullName: after.fullName, phone: after.phone, locale: after.locale },
      cooperativeId: null,
    },
  )

  return toAuthUser(after)
}

/**
 * Changing a password signs out every other device. Somebody who changes their password because
 * they think it was seen expects exactly that, and a session left alive would defeat the point.
 * The device doing the changing keeps its own family, so the user is not thrown out mid-task.
 */
export async function changePassword(
  ctx: RequestContext,
  req: Request,
  input: { currentPassword: string; newPassword: string },
  keepFamilyId: string | null,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: ctx.user.id },
    select: { id: true, passwordHash: true },
  })
  if (!user) throw AppError.unauthenticated()

  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw AppError.validationFailed([
      { field: 'body.currentPassword', messageKey: 'validation.password.incorrect' },
    ])
  }
  assertPasswordAcceptable(input.newPassword, 'body.newPassword')

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false },
    }),
    prisma.refreshSession.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
        ...(keepFamilyId ? { familyId: { not: keepFamilyId } } : {}),
      },
      data: { revokedAt: new Date() },
    }),
  ])

  await writeAudit(
    { ctx, req },
    {
      action: 'user.password.changed',
      entityType: 'User',
      entityId: user.id,
      messageKey: 'audit.user.passwordChanged',
      cooperativeId: null,
    },
  )
}

/**
 * Always succeeds from the caller's point of view, whether or not the address exists. The response
 * and its timing must not differ, because a forgot-password form that answers honestly is a list
 * of every registered user.
 */
export async function requestPasswordReset(email: string, req: Request): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, fullName: true, status: true },
  })
  if (!user || user.status !== 'ACTIVE') return

  const token = generateOpaqueToken()
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000)

  // Any earlier unused token is spent first, so a chain of requests cannot leave several working
  // links in circulation.
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
    }),
  ])

  await deliverPasswordReset({
    email: user.email,
    fullName: user.fullName,
    token,
    expiresAt,
  })
  await writeAudit(
    { req, anonymous: { userId: user.id, label: `${user.fullName} <${user.email}>` } },
    {
      action: 'auth.passwordReset.requested',
      entityType: 'User',
      entityId: user.id,
      messageKey: 'audit.auth.passwordResetRequested',
      cooperativeId: null,
    },
  )
}

export async function resetPassword(
  input: { token: string; password: string },
  req: Request,
): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { status: true, fullName: true, email: true } },
    },
  })

  const expired = !record || record.usedAt !== null || record.expiresAt <= new Date()
  if (expired || record.user.status !== 'ACTIVE') {
    throw new AppError({
      status: 422,
      code: 'VALIDATION_FAILED',
      messageKey: 'errors.resetTokenInvalid',
      message: 'This password reset link has expired or has already been used.',
    })
  }

  assertPasswordAcceptable(input.password, 'body.password')

  // Spending the token, setting the password and revoking every session are one unit. A reset
  // that changed the password but left the old sessions alive would be worse than no reset.
  await prisma.$transaction([
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: await hashPassword(input.password),
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    prisma.refreshSession.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ])

  await writeAudit(
    {
      req,
      anonymous: {
        userId: record.userId,
        label: `${record.user.fullName} <${record.user.email}>`,
      },
    },
    {
      action: 'auth.passwordReset.completed',
      entityType: 'User',
      entityId: record.userId,
      messageKey: 'audit.auth.passwordResetCompleted',
      cooperativeId: null,
    },
  )
}

export async function listSessions(
  userId: string,
  currentFamilyId: string | null,
): Promise<SessionDevice[]> {
  const rows = await prisma.refreshSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      familyId: true,
      userAgent: true,
      ipAddress: true,
      createdAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  return rows.map((row) => ({
    id: row.id,
    userAgent: row.userAgent,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    current: row.familyId === currentFamilyId,
  }))
}

/** Signs out one device by revoking its whole family, not just the token currently in hand. */
export async function revokeSession(
  ctx: RequestContext,
  req: Request,
  sessionId: string,
): Promise<void> {
  const session = await prisma.refreshSession.findFirst({
    where: { id: sessionId, userId: ctx.user.id },
    select: { familyId: true },
  })
  // Scoped to the caller's own rows, so another user's session id reads as "not found" rather than
  // as "forbidden" and cannot be probed.
  if (!session) throw AppError.notFound()

  await prisma.refreshSession.updateMany({
    where: { familyId: session.familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  await writeAudit(
    { ctx, req },
    {
      action: 'auth.session.revoked',
      entityType: 'RefreshSession',
      entityId: sessionId,
      messageKey: 'audit.auth.sessionRevoked',
      cooperativeId: null,
    },
  )
}

/** Re-exported so callers that change a role or an override do not import two modules. */
export { invalidateStaffPermissions, staffPermissions }
