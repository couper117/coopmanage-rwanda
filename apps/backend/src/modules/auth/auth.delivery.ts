import { env, isProduction } from '../../config/env.js'
import { logger } from '../../lib/logger.js'

/**
 * Where a password reset link is sent.
 *
 * Phase 2 delivers the token lifecycle — single use, sixty minutes, uniform responses — but the
 * platform has no message channel yet: SMS arrives in Phase 12 and email with it. Rather than
 * pretend, this module is the one place delivery happens, behind a named port, so adding a channel
 * later is a change here and nowhere else.
 *
 * Outside production the link is written to the server log, which is how a developer completes the
 * flow. In production, with no channel configured, the attempt is recorded as a warning and the
 * link is never logged: writing a working reset link into a production log file would be a way in.
 */
export interface PasswordResetMessage {
  email: string
  fullName: string
  token: string
  expiresAt: Date
}

export function resetLinkFor(token: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, '')}/reset-password/${token}`
}

export async function deliverPasswordReset(message: PasswordResetMessage): Promise<void> {
  if (isProduction) {
    logger.warn(
      { email: message.email },
      'password reset requested but no delivery channel is configured; the link was not sent',
    )
    return
  }

  logger.info(
    { email: message.email, resetLink: resetLinkFor(message.token), expiresAt: message.expiresAt },
    'password reset link (development delivery)',
  )
  return Promise.resolve()
}
