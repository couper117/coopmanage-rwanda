import type { NextFunction, Request, Response } from 'express'
import { HEADERS, ROLE_PERMISSIONS, type PermissionKey } from '@coopmanage/shared'
import { writeAudit } from '../lib/audit.js'
import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/prisma.js'
import { staffPermissions } from '../modules/auth/permissions.service.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Step two of the check in `docs/permissions.md` section 5, and the second of the four layers of
 * tenant isolation in `docs/architecture.md` section 4.
 *
 * The active cooperative arrives as a header, never from the token. This middleware loads the
 * caller's own `CooperativeStaff` row for it and refuses the request when there is no ACTIVE
 * membership, so a valid session for Cooperative A cannot reach Cooperative B by changing a header.
 */
export async function resolveCooperative(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const ctx = req.ctx
  if (!ctx) {
    next(AppError.unauthenticated())
    return
  }

  const headerValue = req.get(HEADERS.cooperativeId)?.trim()
  if (!headerValue || !UUID.test(headerValue)) {
    next(AppError.noCooperativeAccess())
    return
  }

  const cooperative = await prisma.cooperative.findFirst({
    where: { id: headerValue, status: { not: 'ARCHIVED' } },
    select: { id: true, name: true, code: true, isDemo: true },
  })
  if (!cooperative) {
    next(AppError.noCooperativeAccess())
    return
  }

  const staff = await prisma.cooperativeStaff.findFirst({
    where: { cooperativeId: cooperative.id, userId: ctx.user.id, status: 'ACTIVE' },
    select: { id: true },
  })

  if (staff) {
    const { roleKey, permissions } = await staffPermissions(staff.id)
    req.ctx = { ...ctx, cooperative, staff: { id: staff.id, roleKey }, permissions }
    next()
    return
  }

  if (!ctx.user.isPlatformAdmin) {
    next(AppError.noCooperativeAccess())
    return
  }

  // A platform administrator may act without a membership row, and every such request is written
  // to the audit trail. The permissions are the SYSTEM_ADMIN set — read the profile, the staff
  // list, the audit log and reports — not a cooperative manager's, so a platform operator can
  // never quietly alter a cooperative's records.
  req.ctx = {
    ...ctx,
    cooperative,
    staff: { id: `platform:${ctx.user.id}`, roleKey: 'SYSTEM_ADMIN' },
    permissions: new Set<PermissionKey>(ROLE_PERMISSIONS.SYSTEM_ADMIN),
  }
  await writeAudit(
    { ctx: req.ctx, req },
    {
      action: 'platform.tenant_access',
      entityType: 'Cooperative',
      entityId: cooperative.id,
      messageKey: 'audit.platform.tenantAccess',
      messageParams: {
        cooperative: cooperative.name,
        // `req.path` inside a mounted router is relative to the mount point, so it would record
        // "GET /" for every route and name nothing. The query string is dropped: it carries
        // filter values that have no place in the trail.
        path: `${req.method} ${req.originalUrl.split('?')[0]}`,
      },
    },
  )
  next()
}

/**
 * For the handful of endpoints that work with or without a cooperative — `GET /auth/me` is the
 * one in Phase 2, because a user who belongs to no cooperative still has a profile. A header that
 * is present is resolved and enforced exactly as above; only its absence is tolerated.
 */
export async function optionalCooperative(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.get(HEADERS.cooperativeId)?.trim()) {
    next()
    return
  }
  await resolveCooperative(req, res, next)
}
