/**
 * What the application needs of an e-mail channel: one plain-text message to one person.
 *
 * Deliberately small, for the same reason the storage and SMS drivers are: two drivers implement
 * it — the console for development, SMTP for production — and nothing outside this directory
 * imports either. HTML is not offered; the one message the product sends is a link and a sentence,
 * and a plain-text message renders the same in every client a cooperative uses.
 */
export interface MailMessage {
  to: { email: string; name: string }
  subject: string
  text: string
}

export interface MailDriver {
  /** A name for logs and the startup line, so an operator can see which channel is live. */
  readonly name: string
  /** Whether a message sent through this driver actually reaches somebody. */
  readonly delivers: boolean
  send(message: MailMessage): Promise<void>
}
