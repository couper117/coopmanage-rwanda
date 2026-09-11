import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

/**
 * Two kinds of token, deliberately different.
 *
 * The access token is a short-lived JWT the SPA holds in memory. It carries the user id and
 * nothing else — no cooperative id, so a forged or stale token cannot select a tenant, and no
 * permissions, so a role change takes effect on the next request rather than in fifteen minutes.
 *
 * The refresh token is opaque: 32 random bytes with no structure to forge. Only its SHA-256 hash
 * is stored, so a database leak yields nothing that can be presented back to the API.
 */

const ISSUER = 'coopmanage'
const AUDIENCE = 'coopmanage-api'

export interface AccessTokenClaims {
  sub: string
  /** Session family, so a revoked family's access token can be rejected before it expires. */
  fid: string
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign({ fid: claims.fid }, env.JWT_ACCESS_SECRET, {
    subject: claims.sub,
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'],
    issuer: ISSUER,
    audience: AUDIENCE,
  })
}

export type AccessTokenVerdict =
  { kind: 'VALID'; claims: AccessTokenClaims } | { kind: 'EXPIRED' } | { kind: 'INVALID' }

/**
 * Expiry is reported separately from every other failure. The client silently refreshes on an
 * expired token and sends the user to the login screen on anything else, and the two must not be
 * confused: treating a tampered token as expired would put a client into a refresh loop.
 */
export function verifyAccessToken(token: string): AccessTokenVerdict {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    })
    if (typeof payload === 'string' || typeof payload.sub !== 'string') return { kind: 'INVALID' }
    const familyId = (payload as { fid?: unknown }).fid
    if (typeof familyId !== 'string') return { kind: 'INVALID' }
    return { kind: 'VALID', claims: { sub: payload.sub, fid: familyId } }
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) return { kind: 'EXPIRED' }
    return { kind: 'INVALID' }
  }
}

/** Seconds until an access token expires, for the client's refresh timer. */
export function accessTokenLifetimeSeconds(): number {
  const match = /^(\d+)([smhd])$/.exec(env.JWT_ACCESS_TTL)
  if (!match) return 900
  const amount = Number(match[1])
  const unit = match[2] as 's' | 'm' | 'h' | 'd'
  const multiplier = { s: 1, m: 60, h: 3600, d: 86_400 }[unit]
  return amount * multiplier
}

/** 256 bits of randomness, URL-safe so it survives a cookie and a query string unchanged. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time comparison, so a token cannot be recovered one character at a time. */
export function tokenHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
