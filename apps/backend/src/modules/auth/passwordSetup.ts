import { env } from '../../config/env.js'
import { prisma } from '../../lib/prisma.js'
import { generateOpaqueToken, hashToken } from '../../lib/tokens.js'
import { deliverPasswordReset } from './auth.delivery.js'

/**
 * Issues the link by which a newly created account sets its own password.
 *
 * Both ways an account can be created for someone else need this: a manager inviting staff, and a
 * platform administrator creating a cooperative with its first manager. Both create the account
 * with a random password nobody knows, so without this link the account exists and cannot be used.
 * That was a real gap in the first version of cooperative creation, which is why the logic lives
 * here once rather than in each caller.
 *
 * There is no separate invitation token type. Reusing password reset means one lifecycle to keep
 * correct — single use, sixty minutes, uniform responses — and one delivery port.
 */
export async function issuePasswordSetupLink(userId: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, fullName: true, locale: true },
  })

  const token = generateOpaqueToken()
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000)

  // Any earlier unused token is spent first, so a re-invitation cannot leave two working links in
  // circulation.
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: { userId, tokenHash: hashToken(token), expiresAt },
    }),
  ])

  await deliverPasswordReset({
    email: user.email,
    fullName: user.fullName,
    locale: user.locale,
    token,
    expiresAt,
  })
}
