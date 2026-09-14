import type { NextFunction, Request, Response } from 'express'
import { PLATFORM_PERMISSIONS, type PermissionKey } from '@coopmanage/shared'
import { AppError } from '../lib/errors.js'

/**
 * The platform-scope counterpart to `resolveCooperative`.
 *
 * `authenticate` deliberately grants no permissions: a session on its own can reach nothing. The
 * cooperative resolver fills the set from a staff membership; this one fills it from the user's
 * platform-administrator flag, which is the only way a `platform:*` key is ever held.
 *
 * A caller who is not a platform administrator gets **404, not 403**. The whole `/admin` surface
 * then answers exactly as an unknown route would, so an ordinary user cannot discover that it
 * exists, let alone which parts of it are there. This is the same reasoning that makes a
 * wrong-tenant record report "not found" rather than "forbidden".
 */
export function resolvePlatform(req: Request, _res: Response, next: NextFunction): void {
  const ctx = req.ctx
  if (!ctx) {
    next(AppError.unauthenticated())
    return
  }

  if (!ctx.user.isPlatformAdmin) {
    next(AppError.notFound())
    return
  }

  req.ctx = {
    ...ctx,
    permissions: new Set<PermissionKey>(PLATFORM_PERMISSIONS),
  }
  next()
}
