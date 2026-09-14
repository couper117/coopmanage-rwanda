import { describe, expect, it } from 'vitest'
import i18n, { changeLanguage } from '../src/i18n'
import { toI18nKey, translateParams } from '../src/lib/messageKey'

/**
 * How a message the server composed is put into the reader's language.
 *
 * The server never sends a finished sentence. It sends a key and the values to drop into it, and
 * an enum among those values is itself a key, because `SAVINGS` in the middle of a Kinyarwanda
 * sentence is not a translation.
 */
describe('translation keys from the server', () => {
  it('addresses a namespace with a colon', () => {
    expect(toI18nKey('errors.forbidden')).toBe('errors:forbidden')
    expect(toI18nKey('audit.member.created')).toBe('audit:member.created')
  })

  it('leaves a key alone when its first segment is not a namespace', () => {
    // An unknown key still falls back to its own text rather than becoming an odd lookup.
    expect(toI18nKey('something.else')).toBe('something.else')
    expect(toI18nKey('nodots')).toBe('nodots')
  })
})

describe('parameters that are themselves keys', () => {
  it('resolves the ones that name a namespace and leaves the rest untouched', () => {
    const resolved = translateParams(
      {
        member: 'Chantal Mukamana',
        amount: '5000.00',
        reference: 'IN-2026-000042',
        quantity: 4,
        type: 'members.contributions.type.SAVINGS',
      },
      (key) => i18n.t(key),
    )

    expect(resolved.type).toBe('Savings')
    // A name, an amount, a reference and a number are values, not keys.
    expect(resolved.member).toBe('Chantal Mukamana')
    expect(resolved.amount).toBe('5000.00')
    expect(resolved.reference).toBe('IN-2026-000042')
    expect(resolved.quantity).toBe(4)
  })

  it('reads the same parameter in Kinyarwanda', async () => {
    await changeLanguage('rw')
    const resolved = translateParams(
      { from: 'members.status.ACTIVE', to: 'members.status.EXITED' },
      (key) => i18n.t(key),
    )

    // The whole sentence ends up in one language, which is the point.
    expect(resolved.from).toBe('Akora')
    expect(resolved.to).not.toBe('EXITED')
    expect(resolved.to).not.toBe('Left')
    await changeLanguage('en')
  })

  it('survives an entry with no parameters at all', () => {
    expect(translateParams(null, (key) => key)).toEqual({})
    expect(translateParams(undefined, (key) => key)).toEqual({})
  })
})
