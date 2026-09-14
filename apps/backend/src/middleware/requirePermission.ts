import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { PermissionKey } from '@coopmanage/shared'
import { AppError } from '../lib/errors.js'

/**
 * Step three of the check in `docs/permissions.md` section 5. Reads the set already resolved onto
 * `req.ctx` rather than querying again, so a route costs no extra round trip to authorize.
 *
 * Hiding a control in the interface is a usability affordance. This is the enforcement.
 */
export function requirePermission(key: PermissionKey): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const ctx = req.ctx
    if (!ctx) {
      next(AppError.unauthenticated())
      return
    }
    if (!ctx.permissions.has(key)) {
      next(AppError.forbidden(key))
      return
    }
    next()
  }
}

/**
 * For a route that genuinely needs two permissions rather than one.
 *
 * The stock valuation is the case this exists for: it is a money question as much as a stock one,
 * and a storekeeper entitled to count sacks is not thereby entitled to know what the cooperative
 * paid for them. The route registry records the first of the two, which is what the inventory
 * screens gate on; this refuses the request whichever one is missing.
 */
export function requireAllPermissions(...keys: PermissionKey[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const ctx = req.ctx
    if (!ctx) {
      next(AppError.unauthenticated())
      return
    }
    const missing = keys.find((key) => !ctx.permissions.has(key))
    if (missing) {
      next(AppError.forbidden(missing))
      return
    }
    next()
  }
}

/** Reads the context a handler can rely on, so no controller repeats the null check. */
export function requireContext(req: Request) {
  const ctx = req.ctx
  if (!ctx) throw AppError.unauthenticated()
  return ctx
}

/** Reads the resolved tenant. Only reachable behind `resolveCooperative`. */
export function requireTenant(req: Request) {
  const ctx = requireContext(req)
  if (!ctx.cooperative || !ctx.staff) throw AppError.noCooperativeAccess()
  return { ...ctx, cooperative: ctx.cooperative, staff: ctx.staff }
}
