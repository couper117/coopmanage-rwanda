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

/**
 * POST /auth/login.
 *
 * The per-email limit is the one that defends the account: five attempts against one address in
 * fifteen minutes, which stops credential stuffing without help from anywhere else. Progressive
 * lockout on the account itself sits behind it.
 *
 * The per-IP limit is deliberately much looser, and the reason is the users. A Rwandan
 * cooperative office is one internet connection behind one public address, shared by the manager,
 * the accountant, the secretary and the inventory officer. At five per fifteen minutes the fourth
 * person to arrive in the morning cannot sign in, and neither can anyone else until the window
 * passes — the software locking the whole office out of itself. Sixty still stops a single host
 * from working through a list of addresses, which is what the per-IP limit is for; the per-email
 * limit is what protects any individual account.
 */
export const LOGIN_LIMITS = { perIp: 60, perEmail: 5 } as const
export const loginIpLimiter = build({ windowMs: 15 * MINUTE, limit: LOGIN_LIMITS.perIp })
export const loginEmailLimiter = byEmail({ windowMs: 15 * MINUTE, limit: LOGIN_LIMITS.perEmail })

/**
 * POST /auth/forgot-password. Three per hour per address, for the same reason: it is the address
 * that is being protected. The per-IP allowance again assumes a shared office connection.
 */
export const FORGOT_PASSWORD_LIMITS = { perIp: 30, perEmail: 3 } as const
export const forgotPasswordIpLimiter = build({
  windowMs: 60 * MINUTE,
  limit: FORGOT_PASSWORD_LIMITS.perIp,
})
export const forgotPasswordEmailLimiter = byEmail({
  windowMs: 60 * MINUTE,
  limit: FORGOT_PASSWORD_LIMITS.perEmail,
})

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

/**
 * Sending, limited per cooperative rather than per address.
 *
 * `docs/security.md` §8 commits to this and the reason is money: one `POST /sms/send` carries up to
 * five hundred members, and the ordinary write limit would let a cooperative's session spend
 * thousands of messages in a minute — by a loop somebody wrote, by a script, or by a stolen token.
 *
 * Keyed on the **cooperative**, not the IP, because a cooperative's whole office shares one public
 * address and because the cost lands on the cooperative. It therefore has to run after
 * `resolveCooperative`, which is why it is applied on the route rather than app-wide.
 *
 * Ten sends an hour is the figure `docs/api.md` §1 commits to: far above ordinary use — a
 * cooperative publishes a handful of notices a day — and far below a bill anybody would notice too
 * late.
 */
function byCooperative(options: { windowMs: number; limit: number }): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => isTest,
    keyGenerator: (req) => req.ctx?.cooperative?.id ?? 'no-cooperative',
    handler: (_req, _res, next) => {
      next(AppError.rateLimited())
    },
  })
}

export const SMS_SEND_LIMIT = { perHour: 10 } as const

export const smsSendLimiter = byCooperative({
  windowMs: 60 * MINUTE,
  limit: SMS_SEND_LIMIT.perHour,
})

/**
 * Asking the assistant, limited per person and again per cooperative.
 *
 * `docs/security.md` §8 commits to both, and the reason is the planner that has not landed yet: a
 * model-backed planner costs money per question, and a limit added after the thing that charges is
 * a limit added too late. Twenty an hour is far more than anybody asks in a working day; two
 * hundred a day across a cooperative is the ceiling on what one office can spend.
 *
 * The per-person limit uses the signed-in user rather than the address, because a cooperative
 * office shares one public address and a per-IP limit would let the first person through lock out
 * the rest.
 */
export const ASSISTANT_ASK_LIMIT = { perUserPerHour: 20, perCooperativePerDay: 200 } as const

function byUser(options: { windowMs: number; limit: number }): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => isTest,
    keyGenerator: (req) => req.ctx?.user.id ?? 'anonymous',
    handler: (_req, _res, next) => {
      next(AppError.rateLimited())
    },
  })
}

const assistantPerUser = byUser({
  windowMs: 60 * MINUTE,
  limit: ASSISTANT_ASK_LIMIT.perUserPerHour,
})

const assistantPerCooperative = byCooperative({
  windowMs: 24 * 60 * MINUTE,
  limit: ASSISTANT_ASK_LIMIT.perCooperativePerDay,
})

/** Both limits, in order: the person first, because that is the one they can do something about. */
export const assistantAskLimiter: RequestHandler = (req, res, next) => {
  assistantPerUser(req, res, (error?: unknown) => {
    if (error) {
      next(error)
      return
    }
    assistantPerCooperative(req, res, next)
  })
}
