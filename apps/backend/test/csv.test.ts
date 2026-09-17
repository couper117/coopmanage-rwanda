import { describe, expect, it } from 'vitest'
import { csvCell, csvDocument, csvRow } from '../src/lib/csv.js'

/**
 * The CSV guard, which Phase 15 consolidated into one implementation.
 *
 * A cell beginning `=`, `+`, `-` or `@` is executed as a formula the moment a spreadsheet opens the
 * file, and the values in this product's exports are typed by people: a member's name, the
 * description on a money entry. The review found three copies of this rule, two of which guarded
 * four characters and one six — so this file pins the strong version and every export now shares
 * it.
 */
describe('a CSV cell', () => {
  it('defuses a formula, whichever character starts it', () => {
    for (const start of ['=', '+', '-', '@', '\t', '\r']) {
      // No quotation marks in the payload: this assertion is about the leading apostrophe, and
      // the doubling of quotes has a test of its own below.
      const attack = `${start}HYPERLINK(evil)`
      expect(csvCell(attack)).toBe(`"'${attack}"`)
    }
  })

  it('leaves an ordinary value alone', () => {
    expect(csvCell('Mukamana Chantal')).toBe('"Mukamana Chantal"')
    // A minus **inside** a value is not a formula, and quoting it as one would corrupt the figure.
    expect(csvCell('2026-09-30')).toBe('"2026-09-30"')
    expect(csvCell('1234567.00')).toBe('"1234567.00"')
  })

  it('escapes a quotation mark by doubling it', () => {
    // Without this the cell ends early and every column after it in that row is wrong.
    expect(csvCell('Ikigega "Rwanda"')).toBe('"Ikigega ""Rwanda"""')
  })

  it('cannot be broken out of with a newline', () => {
    // A newline inside a quoted cell is part of the cell, not a new row.
    const value = 'line one\nline two'
    expect(csvRow([value])).toBe(`"${value}"`)
  })

  it('writes an empty cell for a missing value, not the word null', () => {
    expect(csvRow(['a', null, undefined, 'b'])).toBe('"a","","","b"')
  })
})

describe('a CSV document', () => {
  it('starts with a byte order mark and ends its rows with CRLF', () => {
    // Without the mark, a Kinyarwanda name arrives as mojibake in the program most cooperatives
    // open these files in.
    const document = csvDocument(['"a"', '"b"'])
    expect(document.startsWith('﻿')).toBe(true)
    expect(document).toBe('﻿"a"\r\n"b"\r\n')
  })
})
