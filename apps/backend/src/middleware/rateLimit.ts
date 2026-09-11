import type { NextFunction, Request, RequestHandler, Response } from 'express'
import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit'
import { isTest } from '../config/env.js'
import { AppError } from '../lib/errors.js'

/**
 * Limits are documented in docs/api.md section 1. They are disabled under test so a suite of a few
 * hundred requests does not trip them, and they are the real thing everywhere else.
 */
function build(options: { windowMs: number; limit: number }): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => isTest,
    handler: (_req, _res, next) => {
      next(AppError.rateLimited())
    },
  })
}

const MINUTE = 60_000

/** Read endpoints: 300 per minute per client. */
export const readLimiter = build({ windowMs: MINUTE, limit: 300 })

/** Mutating endpoints: 60 per minute per client. */
export const writeLimiter = build({ windowMs: MINUTE, limit: 60 })

/**
 * Login and password reset are limited per IP **and** per email address, because either limit
 * alone is easy to walk around: one address attacked from a botnet, or one IP working through a
 * list of addresses. The email key is read from the already-parsed body, so it is applied after
 * validation has confirmed the field is there.
 */
function byEmail(options: { windowMs: number; limit: number }): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => isTest,
    keyGenerator: (req) => {
      const email = (req.body as { email?: unknown } | undefined)?.email
      return typeof email === 'string' ? email.trim().toLowerCase() : 'anonymous'
    },
    handler: (_req, _res, next) => {
      next(AppError.rateLimited())
    },
  })
}

/** POST /auth/login: 5 per 15 minutes per IP and per email. */
export const loginIpLimiter = build({ windowMs: 15 * MINUTE, limit: 5 })
export const loginEmailLimiter = byEmail({ windowMs: 15 * MINUTE, limit: 5 })

/** POST /auth/forgot-password: 3 per hour per IP and per email. */
export const forgotPasswordIpLimiter = build({ windowMs: 60 * MINUTE, limit: 3 })
export const forgotPasswordEmailLimiter = byEmail({ windowMs: 60 * MINUTE, limit: 3 })

/**
 * Liveness is polled continuously by the hosting platform and touches nothing, so it is exempt.
 * Readiness is not exempt: it opens a database connection, and an unauthenticated caller must not
 * be able to drive unbounded queries against the pool.
 */
const EXEMPT_PATHS = new Set(['/health'])

/**
 * Applied once to the whole API so that a route added later is covered without anyone remembering
 * to opt in. Endpoints needing a tighter limit than their method's default still add their own.
 */
export function methodRateLimiter(req: Request, res: Response, next: NextFunction): void {
  if (EXEMPT_PATHS.has(req.path)) {
    next()
    return
  }
  const limiter: RequestHandler =
    req.method === 'GET' || req.method === 'HEAD' ? readLimiter : writeLimiter
  limiter(req, res, next)
}
