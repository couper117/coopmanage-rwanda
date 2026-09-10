import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit'
import { isTest } from '../config/env.js'
import { AppError } from '../lib/errors.js'

/**
 * Limits are documented in docs/api.md section 1. They are disabled under test so that a suite of
 * a few hundred requests does not trip them, and they are the real thing everywhere else.
 */
function build(options: { windowMs: number; limit: number }): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: isTest ? 0 : options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => isTest,
    handler: (_req, _res, next) => {
      next(AppError.rateLimited())
    },
  })
}

const MINUTE = 60_000

/** Applied to every read endpoint: 300 per minute per client. */
export const readLimiter = build({ windowMs: MINUTE, limit: 300 })

/** Applied to every mutating endpoint: 60 per minute per client. */
export const writeLimiter = build({ windowMs: MINUTE, limit: 60 })

/** Login and password reset. Tightened further per account in Phase 2. */
export const authLimiter = build({ windowMs: 15 * MINUTE, limit: 5 })
