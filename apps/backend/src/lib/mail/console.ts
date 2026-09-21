import { logger } from '../logger.js'
import type { MailDriver, MailMessage } from './types.js'

/**
 * No channel: the message is written to the log, which is how a developer completes a
 * password-setting flow, and how production behaves before an SMTP account exists.
 *
 * Whether the body is logged depends on where this runs. Outside production the whole message is
 * written, link included. In production the body is **never** logged — a working password link in
 * a log file that operators and a hosting platform can read would be a way in — and the line is a
 * warning that names the recipient and says the message was not delivered, so an operator can act.
 */
export class ConsoleMailDriver implements MailDriver {
  readonly name = 'console'
  readonly delivers = false

  constructor(private readonly logBody: boolean) {}

  send(message: MailMessage): Promise<void> {
    if (this.logBody) {
      logger.info(
        { to: message.to.email, subject: message.subject, text: message.text },
        'e-mail (development delivery: not sent, written here instead)',
      )
    } else {
      logger.warn(
        { to: message.to.email, subject: message.subject },
        'e-mail not delivered: no MAIL_DRIVER is configured; the message was not sent',
      )
    }
    return Promise.resolve()
  }
}
