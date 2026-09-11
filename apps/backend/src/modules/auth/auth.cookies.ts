import type { CookieOptions, Request, Response } from 'express'
import { env, isProduction } from '../../config/env.js'

/**
 * The refresh cookie. `HttpOnly` so no script can read it, `Secure` in production, `SameSite=Lax`
 * so it is not sent on a cross-site request, and scoped to the two paths that consume it rather
 * than to the whole API — a cookie that is never sent to an endpoint cannot be stolen from one.
 *
 * The narrow scope is why the profile screen marks the current device from the access token's
 * session family instead of from this cookie: `GET /auth/sessions` never receives it.
 */
export const REFRESH_COOKIE_NAME = 'coopmanage.refresh'

export const REFRESH_COOKIE_PATHS = ['/api/v1/auth/refresh', '/api/v1/auth/logout'] as const

function options(maxAgeMs?: number): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
  }
}

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  const maxAge = Math.max(0, expiresAt.getTime() - Date.now())
  for (const path of REFRESH_COOKIE_PATHS) {
    res.cookie(REFRESH_COOKIE_NAME, token, { ...options(maxAge), path })
  }
}

export function clearRefreshCookie(res: Response): void {
  for (const path of REFRESH_COOKIE_PATHS) {
    res.clearCookie(REFRESH_COOKIE_NAME, { ...options(), path })
  }
}

export function readRefreshCookie(req: Request): string | null {
  // Express types `req.cookies` as `any`. Narrowing it once, here, keeps that `any` from spreading
  // into every caller and makes the shape the parser actually produces explicit.
  const cookies = (req as unknown as { cookies?: Record<string, unknown> }).cookies
  const value = cookies?.[REFRESH_COOKIE_NAME]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function refreshCookieExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
}

/**
 * The cookie-authenticated endpoints are the one part of the API a browser will send credentials
 * to without being asked, so they check the origin as well as relying on `SameSite=Lax`. A caller
 * that sends no `Origin` at all is not a browser and is left to the cookie itself.
 */
export function originIsAllowed(req: Request): boolean {
  const origin = req.get('origin')
  if (!origin) return true
  return env.CORS_ORIGINS.includes(origin)
}
