import { describe, expect, it } from 'vitest'
import {
  REPORTS,
  auditActionLabel,
  hasAuditActionLabel,
  REPORT_FORMATS,
  REPORT_LABELS,
  REPORT_TYPES,
  formatReportValue,
  isPermissionKey,
  reportColumnAlign,
  reportDate,
  reportLabel,
  reportPeriodLabel,
} from '../src/index.js'

/**
 * The report catalogue is the one place where user-facing strings live outside the frontend's
 * translation files, because a PDF is rendered on the server where no i18next instance exists.
 * That exception is only safe while these tests hold: the two languages must carry the same keys,
 * and a report must never be able to name a permission that does not exist.
 */
describe('the report catalogue', () => {
  it('describes every report type exactly once', () => {
    expect(Object.keys(REPORTS).sort()).toEqual([...REPORT_TYPES].sort())
    for (const type of REPORT_TYPES) {
      expect(REPORTS[type].type).toBe(type)
    }
  })

  it('names only permissions that exist', () => {
    for (const report of Object.values(REPORTS)) {
      expect(isPermissionKey(report.permission)).toBe(true)
      for (const permission of Object.values(report.sectionPermissions)) {
        expect(permission && isPermissionKey(permission)).toBe(true)
      }
    }
  })

  it('offers the three formats a cooperative office needs', () => {
    expect(REPORT_FORMATS).toEqual(['pdf', 'csv', 'xlsx'])
  })

  it('has a title for every report in both languages', () => {
    for (const type of REPORT_TYPES) {
      for (const locale of ['EN', 'RW'] as const) {
        const title = reportLabel(locale, `report.${type}`)
        expect(title).not.toBe(`report.${type}`)
        expect(title.trim().length).toBeGreaterThan(0)
      }
    }
  })
})

describe('the two languages', () => {
  it('carry exactly the same keys, so no report prints English into a Kinyarwanda page', () => {
    const en = Object.keys(REPORT_LABELS.EN).sort()
    const rw = Object.keys(REPORT_LABELS.RW).sort()
    expect(rw).toEqual(en)
  })

  it('does not leave a Kinyarwanda label as a copy of the English one', () => {
    // A copied label is how a half-done translation hides. Codes and numerals are the only honest
    // reason for two identical strings, and this catalogue has none of those.
    const copied = Object.keys(REPORT_LABELS.EN).filter(
      (key) => REPORT_LABELS.EN[key] === REPORT_LABELS.RW[key],
    )
    expect(copied).toEqual([])
  })

  it('keeps every placeholder a sentence needs in both languages', () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort()
    for (const key of Object.keys(REPORT_LABELS.EN)) {
      expect(placeholders(REPORT_LABELS.RW[key] ?? '')).toEqual(
        placeholders(REPORT_LABELS.EN[key] ?? ''),
      )
    }
  })
})

describe('reportLabel', () => {
  it('substitutes values into a sentence', () => {
    expect(reportLabel('EN', 'report.period', { from: '1 September', to: '30 September' })).toBe(
      '1 September to 30 September',
    )
    expect(reportLabel('RW', 'report.page', { page: 3 })).toBe('Urupapuro 3')
  })

  it('leaves a placeholder alone when no value was given, rather than printing "undefined"', () => {
    expect(reportLabel('EN', 'report.generatedBy')).toBe('Produced by {name}')
  })

  it('falls back to English for a key a language has not been given', () => {
    // Defensive: the parity test above means this should never happen, but a report already on its
    // way to a printer should lose a translation rather than a sentence.
    const bundle = REPORT_LABELS.RW as Record<string, string>
    const saved = bundle['column.date']
    delete bundle['column.date']
    try {
      expect(reportLabel('RW', 'column.date')).toBe('Date')
    } finally {
      bundle['column.date'] = saved as string
    }
  })

  it('returns an unknown key unchanged, loud enough to notice and harmless on paper', () => {
    expect(reportLabel('EN', 'column.notAThing')).toBe('column.notAThing')
  })
})

describe('auditActionLabel', () => {
  it('turns an action code into a sentence a cooperative auditor can read', () => {
    expect(auditActionLabel('EN', 'finance.transaction.voided')).toBe('Money entry cancelled')
    expect(auditActionLabel('RW', 'inventory.received')).toBe('Ibicuruzwa byakiriwe')
  })

  it('falls back to "other action" rather than printing the code', () => {
    expect(auditActionLabel('EN', 'something.nobody.added')).toBe('Other action')
    expect(auditActionLabel('RW', 'something.nobody.added')).toBe('Ikindi gikorwa')
    expect(hasAuditActionLabel('something.nobody.added')).toBe(false)
    expect(hasAuditActionLabel('member.created')).toBe(true)
  })
})

describe('formatReportValue', () => {
  it('writes money without a currency suffix, because the column heading carries it', () => {
    expect(formatReportValue('money', '1234567.00', { locale: 'EN' })).toBe('1,234,567')
    expect(formatReportValue('money', '1234.50', { locale: 'EN' })).toBe('1,234.5')
  })

  it('writes a date in the report’s own language', () => {
    expect(formatReportValue('date', '2026-09-30', { locale: 'EN' })).toBe('30 September 2026')
    expect(formatReportValue('date', '2026-09-30', { locale: 'RW' })).toBe('30 Nzeri 2026')
  })

  it('prints an empty cell for nothing, not the word "null"', () => {
    expect(formatReportValue('text', null, { locale: 'EN' })).toBe('')
    expect(formatReportValue('money', '', { locale: 'EN' })).toBe('')
  })

  it('keeps a quantity’s three decimals only where they say something', () => {
    expect(formatReportValue('quantity', '1240.500', { locale: 'EN' })).toBe('1,240.5')
    expect(formatReportValue('quantity', '12.000', { locale: 'EN' })).toBe('12')
  })

  it('right-aligns figures and left-aligns words', () => {
    expect(reportColumnAlign({ key: 'a', label: 'A', type: 'money' })).toBe('right')
    expect(reportColumnAlign({ key: 'b', label: 'B', type: 'text' })).toBe('left')
    expect(reportColumnAlign({ key: 'c', label: 'C', type: 'number', align: 'left' })).toBe('left')
  })
})

describe('reportDate', () => {
  it('names all twelve months in both languages', () => {
    const months = Array.from(
      { length: 12 },
      (_, index) => `2026-${String(index + 1).padStart(2, '0')}-01`,
    )
    const en = months.map((iso) => reportDate(iso, 'EN'))
    const rw = months.map((iso) => reportDate(iso, 'RW'))
    expect(new Set(en).size).toBe(12)
    expect(new Set(rw).size).toBe(12)
    // No month may be left in English inside a Kinyarwanda report.
    expect(en.filter((value, index) => value === rw[index])).toEqual([])
  })

  it('drops the leading zero from a day, the way it is written by hand', () => {
    expect(reportDate('2026-01-05', 'EN')).toBe('5 January 2026')
  })
})

describe('reportPeriodLabel', () => {
  it('writes the year once when the period stays inside it', () => {
    expect(reportPeriodLabel('2026-09-01', '2026-09-30', 'EN')).toBe(
      '1 September to 30 September 2026',
    )
    expect(reportPeriodLabel('2026-09-01', '2026-09-30', 'RW')).toBe(
      'Kuva 1 Nzeri kugeza 30 Nzeri 2026',
    )
  })

  it('writes both years across a year boundary, which is the case the repetition is for', () => {
    expect(reportPeriodLabel('2025-12-01', '2026-01-31', 'EN')).toBe(
      '1 December 2025 to 31 January 2026',
    )
  })
})
