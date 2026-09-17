/**
 * One CSV cell, quoted and defused.
 *
 * A cell beginning `=`, `+`, `-` or `@` is executed as a **formula** the moment a spreadsheet opens
 * the file. That is a real way to attack whoever opens a cooperative's export, and the values here
 * are typed by people: a member's name, the description on a money entry, a product a cooperative
 * named itself. Prefixing an apostrophe makes the spreadsheet treat the cell as text.
 *
 * A leading tab or carriage return is guarded too. Some spreadsheets strip leading whitespace
 * before deciding what a cell is, so `\tSUM(...)` reaches the same place by a route that a check
 * for `=` alone does not see.
 *
 * **One implementation, used by every export.** Phase 15 found three copies of this rule — the
 * report renderer, the members export and the ledger export — of which two guarded four characters
 * and one guarded six. Three copies of a security rule is three chances for one of them to be the
 * weak one, and the weak one is the export somebody opens.
 */
const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value: string): string {
  const guarded = FORMULA_START.test(value) ? `'${value}` : value
  // Doubling is how CSV escapes a quotation mark; without it a value containing one ends the cell
  // early and every column after it in that row is wrong.
  return `"${guarded.replaceAll('"', '""')}"`
}

/** A whole row, with every cell guarded. A null is an empty cell rather than the word "null". */
export function csvRow(values: readonly (string | null | undefined)[]): string {
  return values.map((value) => csvCell(value ?? '')).join(',')
}

/**
 * A byte order mark, so Excel reads the file as UTF-8.
 *
 * Without it a Kinyarwanda name with an apostrophe or an accented character arrives as mojibake in
 * the one program most cooperatives will open these files in.
 */
export const CSV_BOM = '﻿'

/** CSV rows end with CRLF, which is what the format says and what Excel expects. */
export function csvDocument(lines: readonly string[]): string {
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`
}
