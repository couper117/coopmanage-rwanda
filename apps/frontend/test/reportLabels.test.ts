import { REPORT_LABELS, REPORT_TYPES, enumLabel } from '@coopmanage/shared'
import { describe, expect, it } from 'vitest'
import enFinance from '../src/i18n/locales/en/finance.json'
import enInventory from '../src/i18n/locales/en/inventory.json'
import enMembers from '../src/i18n/locales/en/members.json'
import enReports from '../src/i18n/locales/en/reports.json'
import enSales from '../src/i18n/locales/en/sales.json'
import rwFinance from '../src/i18n/locales/rw/finance.json'
import rwInventory from '../src/i18n/locales/rw/inventory.json'
import rwMembers from '../src/i18n/locales/rw/members.json'
import rwReports from '../src/i18n/locales/rw/reports.json'
import rwSales from '../src/i18n/locales/rw/sales.json'

/**
 * The report catalogue holds the only user-facing strings outside these translation files, because
 * a PDF is rendered on the server where no i18next instance exists. That exception is only safe
 * while this test holds.
 *
 * A report that called a suspended member something different from the member screen, or a sale
 * "Not confirmed" where the sales screen says "Draft", is a report somebody quotes against the
 * screen and loses an argument over. So the catalogue's `enum.*` labels are not a second
 * translation of the same words: they are the same words, and this test fails the build when the
 * two drift apart.
 */

type Bundle = Record<string, unknown>

function dig(bundle: Bundle, path: string): Record<string, string> {
  let node: unknown = bundle
  for (const part of path.split('.')) {
    node = (node as Bundle)[part]
  }
  return node as Record<string, string>
}

/** Each report enum group, and where the interface keeps the same words. */
const MIRRORED: readonly { group: string; en: Bundle; rw: Bundle; path: string }[] = [
  { group: 'memberStatus', en: enMembers, rw: rwMembers, path: 'status' },
  { group: 'memberPosition', en: enMembers, rw: rwMembers, path: 'position' },
  { group: 'contributionType', en: enMembers, rw: rwMembers, path: 'contributions.type' },
  { group: 'shareType', en: enMembers, rw: rwMembers, path: 'shares.type' },
  { group: 'paymentMethod', en: enFinance, rw: rwFinance, path: 'method' },
  { group: 'paymentStatus', en: enSales, rw: rwSales, path: 'paymentStatus' },
  { group: 'saleStatus', en: enSales, rw: rwSales, path: 'status' },
  { group: 'financeKind', en: enFinance, rw: rwFinance, path: 'kind' },
  { group: 'postingStatus', en: enFinance, rw: rwFinance, path: 'status' },
  { group: 'inventoryType', en: enInventory, rw: rwInventory, path: 'movementType' },
]

describe('the report catalogue’s enum labels', () => {
  for (const { group, en, rw, path } of MIRRORED) {
    it(`says the same as the interface for ${group}`, () => {
      const english = dig(en, path)
      const kinyarwanda = dig(rw, path)

      for (const value of Object.keys(english)) {
        expect(enumLabel('EN', group, value), `${group}.${value} in English`).toBe(english[value])
        expect(enumLabel('RW', group, value), `${group}.${value} in Kinyarwanda`).toBe(
          kinyarwanda[value],
        )
      }
    })

    it(`covers every value the interface knows for ${group}`, () => {
      // The other direction: a value added to the interface and not to the catalogue would print
      // as a bare code on a report, which is what the fallback is for and not what it is for.
      for (const value of Object.keys(dig(en, path))) {
        expect(`enum.${group}.${value}` in REPORT_LABELS.EN, `${group}.${value}`).toBe(true)
      }
    })
  }
})

describe('the report titles', () => {
  it('are the same on the screen and on the paper', () => {
    // The screen falls back to its own `reports:type.*` while the catalogue is loading, so the
    // two have to agree or the heading would change under the reader.
    for (const type of REPORT_TYPES) {
      expect(REPORT_LABELS.EN[`report.${type}`]).toBe(dig(enReports, 'type')[type])
      expect(REPORT_LABELS.RW[`report.${type}`]).toBe(dig(rwReports, 'type')[type])
    }
  })
})
