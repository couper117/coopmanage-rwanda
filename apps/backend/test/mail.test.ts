import { describe, expect, it } from 'vitest'
import { SmtpMailDriver } from '../src/lib/mail/smtp.js'
import { passwordSetupMessage } from '../src/lib/mail/templates.js'

/**
 * The e-mail channel: the message in both languages, and delivery through a real SMTP
 * conversation when `SMTP_TEST_URL` points at a catcher (Mailpit, in a container, which the local
 * instructions and CI both start). Without it the delivery half is skipped and says so.
 */
describe('the password-setting message', () => {
  const input = {
    to: { email: 'mukamana@example.test', name: 'Mukamana Chantal' },
    link: 'https://app.example.rw/reset-password/abc123',
    expiresInMinutes: 60,
    appName: 'CoopManage Rwanda',
  }

  it('is in the reader’s language, carries the link once, and says how long it lasts', () => {
    const en = passwordSetupMessage({ ...input, locale: 'EN' })
    expect(en.subject).toBe('CoopManage Rwanda: set your password')
    expect(en.text.split(input.link).length - 1).toBe(1)
    expect(en.text).toContain('60 minutes')
    expect(en.text).toContain('Mukamana Chantal')

    const rw = passwordSetupMessage({ ...input, locale: 'RW' })
    expect(rw.subject).toBe('CoopManage Rwanda: shyiraho ijambobanga ryawe')
    expect(rw.text).toContain(input.link)
    expect(rw.text).toContain('minota 60')
    expect(rw.text).not.toBe(en.text)
  })

  it('refuses a transport URL that is not SMTP, before opening anything', () => {
    expect(() => new SmtpMailDriver('https://mail.example', 'x@example.test')).toThrow(/smtp/)
  })
})

const smtpUrl = process.env.SMTP_TEST_URL
const apiUrl = process.env.SMTP_TEST_API_URL ?? 'http://127.0.0.1:8025'

describe.skipIf(!smtpUrl)('delivery through a real SMTP server', () => {
  // Built lazily: a skipped block still evaluates its body, and there is no URL to build on.
  const driver = new SmtpMailDriver(
    smtpUrl ?? 'smtp://skipped.invalid',
    'CoopManage <no-reply@example.test>',
  )

  it('authenticates at the probe and delivers the message it was given', async () => {
    await expect(driver.verify()).resolves.toBeUndefined()

    const marker = `probe-${Date.now()}`
    await driver.send(
      passwordSetupMessage({
        to: { email: `${marker}@example.test`, name: 'Uwase Claudine' },
        locale: 'RW',
        link: `https://app.example.rw/reset-password/${marker}`,
        expiresInMinutes: 60,
        appName: 'CoopManage Rwanda',
      }),
    )

    // Read it back from the catcher's API: the recipient, the subject and the link, as sent.
    const search = await fetch(`${apiUrl}/api/v1/search?query=${marker}`)
    const found = (await search.json()) as {
      messages: { ID: string; To: { Address: string }[]; Subject: string }[]
    }
    expect(found.messages).toHaveLength(1)
    const message = found.messages[0]
    expect(message?.To[0]?.Address).toBe(`${marker}@example.test`)
    expect(message?.Subject).toBe('CoopManage Rwanda: shyiraho ijambobanga ryawe')

    const body = await fetch(`${apiUrl}/api/v1/message/${message?.ID}`)
    const detail = (await body.json()) as { Text: string; HTML: string }
    expect(detail.Text).toContain(`/reset-password/${marker}`)
    expect(detail.HTML).toBe('')
  })

  it('reports a wrong password at the probe rather than at the first message', async () => {
    const wrong = new URL(smtpUrl as string)
    wrong.username = 'nobody'
    wrong.password = 'wrong'
    const driver2 = new SmtpMailDriver(wrong.toString(), 'x@example.test')
    // The catcher is started with authentication required (MP_SMTP_AUTH), so this is a real
    // refusal and not a server that accepts anything.
    await expect(driver2.verify()).rejects.toThrow(/auth|535|credentials/i)
  })
})
