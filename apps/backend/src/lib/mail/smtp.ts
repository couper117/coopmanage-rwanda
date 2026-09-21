import { createTransport, type Transporter } from 'nodemailer'
import type { MailDriver, MailMessage } from './types.js'

/**
 * SMTP, through nodemailer, from one URL: `smtp://user:pass@host:587` (STARTTLS) or
 * `smtps://user:pass@host:465` (TLS from the first byte). The URL is the whole configuration, so
 * a provider's credentials are one secret rather than five variables that can disagree.
 *
 * `verify()` at startup opens a connection and authenticates without sending anything, so a wrong
 * password fails the deployment rather than the first cooperative's invitation.
 */
export class SmtpMailDriver implements MailDriver {
  readonly name: string
  readonly delivers = true
  private readonly transporter: Transporter
  private readonly from: string

  constructor(url: string, from: string) {
    const parsed = new URL(url)
    if (parsed.protocol !== 'smtp:' && parsed.protocol !== 'smtps:') {
      throw new Error('SMTP_URL must start with smtp:// or smtps://')
    }
    this.transporter = createTransport(url)
    this.from = from
    // The host only: the URL carries the password, and the name is for a log line.
    this.name = `smtp(${parsed.host})`
  }

  async verify(): Promise<void> {
    await this.transporter.verify()
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: { address: message.to.email, name: message.to.name },
      subject: message.subject,
      text: message.text,
    })
  }
}
