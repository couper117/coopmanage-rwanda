import type { Locale } from '@coopmanage/shared'
import type { MailMessage } from './types.js'

/**
 * The messages the product sends, in both languages. Plain text: a greeting, what the link is for,
 * the link, how long it lasts, and what to do if it was not asked for.
 *
 * Kept here rather than in the translation bundles because they are not interface strings: the
 * bundles are split by screen and shipped to the browser, and a message the server sends belongs
 * to the server. Both languages are written side by side so neither can be added without the other.
 */
export function passwordSetupMessage(input: {
  to: { email: string; name: string }
  locale: Locale
  link: string
  expiresInMinutes: number
  appName: string
}): MailMessage {
  const { to, link, expiresInMinutes, appName } = input
  if (input.locale === 'RW') {
    return {
      to,
      subject: `${appName}: shyiraho ijambobanga ryawe`,
      text: [
        `Muraho ${to.name},`,
        '',
        `Kanda kuri iyi link ushyireho ijambobanga rya konti yawe kuri ${appName}:`,
        link,
        '',
        `Iyi link ikora mu minota ${expiresInMinutes} gusa, kandi ikoreshwa rimwe.`,
        'Niba atari wowe wasabye iyi link, ntacyo ukora: konti yawe ntacyo ihinduka.',
      ].join('\n'),
    }
  }
  return {
    to,
    subject: `${appName}: set your password`,
    text: [
      `Hello ${to.name},`,
      '',
      `Follow this link to set the password for your ${appName} account:`,
      link,
      '',
      `The link works for ${expiresInMinutes} minutes and can be used once.`,
      'If you did not ask for this, you need do nothing: your account is unchanged.',
    ].join('\n'),
  }
}
