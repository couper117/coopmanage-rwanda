import { beforeAll, describe, expect, it } from 'vitest'
import i18n, { AUDIT_MESSAGE_NAMESPACES, changeLanguage, loadNamespaces } from '../src/i18n'
import { toI18nKey, translateParams } from '../src/lib/messageKey'

/**
 * The namespaces an audit entry can quote are fetched when the activity log is opened, not bundled
 * with the shell, so a test of the resolver has to load them the same way the route does. Asserting
 * against strings that happened to be bundled would be testing a situation the application is no
 * longer in.
 */
beforeAll(async () => {
  await loadNamespaces(AUDIT_MESSAGE_NAMESPACES)
})

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

  it('resolves a finance kind sent from the books', () => {
    const resolved = translateParams({ name: 'Fuel', kind: 'audit.finance.kind.EXPENSE' }, (key) =>
      i18n.t(key),
    )
    // The key lives in the audit namespace rather than the finance one, so an audit sentence does
    // not depend on a screen's own strings having been loaded.
    expect(resolved.kind).toBe('money out')
    expect(resolved.name).toBe('Fuel')
  })

  it('renders a low-stock warning in both languages, before any screen shows one', async () => {
    const params = {
      product: 'Fertiliser, NPK 17-17-17',
      sku: 'FERTILISER-NPK',
      quantity: '8.000',
      minimum: '40.000',
      unit: 'sack',
    }

    // The notification centre is Phase 12, but Phase 6 already writes these rows. A stored key
    // with no translation behind it is a screen that will read as broken the day it is built, so
    // the wording exists now and this is what proves it.
    const english = i18n.t(toI18nKey('notifications.lowStock.low'), params)
    expect(english).toContain('Fertiliser')
    expect(english).toContain('8.000')
    expect(english).not.toContain('notifications')

    await changeLanguage('rw')
    const kinyarwanda = i18n.t(toI18nKey('notifications.lowStock.empty'), params)
    expect(kinyarwanda).toContain('40.000')
    expect(kinyarwanda).not.toContain('notifications')
    expect(kinyarwanda).not.toBe(english)
    await changeLanguage('en')
  })

  it('survives an entry with no parameters at all', () => {
    expect(translateParams(null, (key) => key)).toEqual({})
    expect(translateParams(undefined, (key) => key)).toEqual({})
  })
})

/**
 * A name a cooperative gave in both languages.
 *
 * An audit entry records the names it was written with, and where the cooperative had two it
 * records both: `category` and `categoryRw`. The reader is shown the one that matches the page
 * they are on, so the cooperative's own expense category does not read in English on a Kinyarwanda
 * screen — the whole point of Phase 11 — and does not read in Kinyarwanda on an English one.
 */
describe('a name recorded in both languages', () => {
  it('shows the English name to an English reader', async () => {
    await changeLanguage('en')
    const resolved = translateParams(
      {
        reference: 'FIN-2026-000412',
        category: 'Sale of produce',
        categoryRw: 'Kugurisha umusaruro',
      },
      (key) => i18n.t(key),
    )
    expect(resolved.category).toBe('Sale of produce')
    // And the Kinyarwanda copy is not left in the options: the sentence interpolates `{{category}}`
    // in both languages, so a second placeholder would be a different sentence.
    expect(resolved.categoryRw).toBeUndefined()
  })

  it('shows the Kinyarwanda name to a Kinyarwanda reader', async () => {
    await changeLanguage('rw')
    const resolved = translateParams(
      {
        reference: 'FIN-2026-000412',
        category: 'Sale of produce',
        categoryRw: 'Kugurisha umusaruro',
      },
      (key) => i18n.t(key),
    )
    expect(resolved.category).toBe('Kugurisha umusaruro')
    expect(resolved.reference).toBe('FIN-2026-000412')
    await changeLanguage('en')
  })

  it('falls back to what an older entry recorded', async () => {
    // Every entry written before the convention carries only the English name. A trail shows what
    // was recorded; it does not go looking for a better version.
    await changeLanguage('rw')
    const resolved = translateParams({ category: 'Sale of produce' }, (key) => i18n.t(key))
    expect(resolved.category).toBe('Sale of produce')
    await changeLanguage('en')
  })

  it('still resolves an enum that arrives as a key', async () => {
    await changeLanguage('rw')
    const resolved = translateParams({ type: 'members.contributions.type.SAVINGS' }, (key) =>
      i18n.t(key),
    )
    expect(resolved.type).not.toBe('members.contributions.type.SAVINGS')
    await changeLanguage('en')
  })
})
