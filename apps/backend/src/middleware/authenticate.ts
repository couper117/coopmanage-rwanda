import type { NextFunction, Request, Response } from 'express'
import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/prisma.js'
import { verifyAccessToken } from '../lib/tokens.js'

/**
 * Step one of the check described in `docs/permissions.md` section 5. Establishes who is calling
 * and nothing else: no cooperative is selected here, because the token deliberately carries none.
 *
 * An expired token is reported as `TOKEN_EXPIRED` rather than `UNAUTHENTICATED`, so the client
 * knows to refresh silently instead of dropping the user on the login screen mid-sentence.
 */
/** The session's own endpoints, which a locked-to-password-change account may still use. */
const PASSWORD_CHANGE_ALLOWED = /^\/api\/v1\/auth\/(me|change-password|sessions|logout)(\/|\?|$)/

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.get('authorization')
  if (!header?.startsWith('Bearer ')) {
    next(AppError.unauthenticated())
    return
  }

  const verdict = verifyAccessToken(header.slice('Bearer '.length).trim())
  if (verdict.kind === 'EXPIRED') {
    next(AppError.tokenExpired())
    return
  }
  if (verdict.kind === 'INVALID') {
    next(AppError.unauthenticated())
    return
  }

  const user = await prisma.user.findUnique({
    where: { id: verdict.claims.sub },
    select: {
      id: true,
      email: true,
      fullName: true,
      isPlatformAdmin: true,
      locale: true,
      status: true,
      mustChangePassword: true,
    },
  })

  // A suspended account is turned away exactly like an unknown one. Saying "your account is
  // suspended" to a bearer of a stolen token tells them the account is worth pursuing.
  if (!user || user.status !== 'ACTIVE') {
    next(AppError.unauthenticated())
    return
  }

  // The session family is checked as well as the signature. Signing out everywhere revokes the
  // family, and without this an access token minted a minute earlier would keep working until it
  // expired — which is precisely the window someone signing out in a hurry is trying to close.
  const familyIsLive = await prisma.refreshSession.findFirst({
    where: { familyId: verdict.claims.fid, userId: user.id, revokedAt: null },
    select: { id: true },
  })
  if (!familyIsLive) {
    next(AppError.unauthenticated())
    return
  }

  // An account that must still set its own password can reach its own session — read it,
  // change the password, sign out — and nothing else. The flag is set on an account created
  // with a credential somebody else chose: the seeded administrator in production, a member of
  // staff invited with a temporary password. `docs/security.md` §2.
  if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.test(req.originalUrl)) {
    next(AppError.passwordChangeRequired())
    return
  }

  req.ctx = {
    requestId: req.requestId,
    sessionFamilyId: verdict.claims.fid,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isPlatformAdmin: user.isPlatformAdmin,
      locale: user.locale,
    },
    permissions: new Set(),
  }
  next()
}
