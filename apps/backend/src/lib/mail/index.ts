import { env, isProduction } from '../../config/env.js'
import { logger } from '../logger.js'
import { ConsoleMailDriver } from './console.js'
import { SmtpMailDriver } from './smtp.js'
import type { MailDriver } from './types.js'

export type { MailDriver, MailMessage } from './types.js'

/**
 * The one place an e-mail channel is chosen. The environment schema has already checked that
 * `SMTP_URL` and `SMTP_FROM` are present when the driver is `smtp`.
 *
 * Production is allowed to run on the console driver, unlike storage, because a platform with no
 * e-mail can still be administered — the platform administrator relays a password link by hand —
 * whereas a platform with no object store loses documents. It is loud about it: a warning at
 * startup and one per undelivered message.
 */
function build(): MailDriver {
  const driver =
    env.MAIL_DRIVER === 'smtp'
      ? new SmtpMailDriver(env.SMTP_URL as string, env.SMTP_FROM as string)
      : new ConsoleMailDriver(!isProduction)
  logger.info({ driver: driver.name, delivers: driver.delivers }, 'e-mail channel ready')
  if (isProduction && !driver.delivers) {
    logger.warn(
      'no e-mail channel is configured: password links will not be sent; set MAIL_DRIVER=smtp',
    )
  }
  return driver
}

let instance: MailDriver | null = null

export function mail(): MailDriver {
  instance ??= build()
  return instance
}

/** Startup check: authenticates to the SMTP server once, so a wrong password fails the boot. */
export async function probeMail(): Promise<void> {
  const driver = mail()
  if (driver instanceof SmtpMailDriver) await driver.verify()
}

/** Replaces the driver. Tests only — nothing in the application calls it. */
export function setMailDriver(driver: MailDriver | null): void {
  instance = driver
}
