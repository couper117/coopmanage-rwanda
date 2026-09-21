import type { Locale } from '@coopmanage/shared'
import { env } from '../../config/env.js'
import { mail } from '../../lib/mail/index.js'
import { passwordSetupMessage } from '../../lib/mail/templates.js'

/**
 * Where a password reset link is sent: the e-mail channel, whichever driver is live.
 *
 * Phase 2 delivered the token lifecycle — single use, sixty minutes, uniform responses — behind
 * this port with no channel behind it. Phase 18 put SMTP behind it. The console driver keeps the
 * earlier behaviour for development (the link in the log) and for a production deployment that
 * has no SMTP account yet (a warning, and never the link).
 */
export interface PasswordResetMessage {
  email: string
  fullName: string
  locale: Locale
  token: string
  expiresAt: Date
}

export function resetLinkFor(token: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, '')}/reset-password/${token}`
}

export async function deliverPasswordReset(message: PasswordResetMessage): Promise<void> {
  await mail().send(
    passwordSetupMessage({
      to: { email: message.email, name: message.fullName },
      locale: message.locale,
      link: resetLinkFor(message.token),
      expiresInMinutes: Math.max(
        1,
        Math.round((message.expiresAt.getTime() - Date.now()) / 60_000),
      ),
      appName: 'CoopManage Rwanda',
    }),
  )
}
