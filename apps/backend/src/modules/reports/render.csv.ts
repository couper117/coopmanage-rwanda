import { reportLabel, type ReportDocument, type ReportRow } from '@coopmanage/shared'

/**
 * A report as a CSV file.
 *
 * A report is several sections and a CSV is one grid, so the sections are stacked with a blank line
 * and a title between them. That is what a cooperative's accountant does by hand anyway, and it
 * opens in Excel, in LibreOffice and in Google Sheets without a conversion step.
 *
 * Figures are written **raw** — `1234567.00`, not `1,234,567` — because the first thing anybody
 * does with this file is sum a column, and a value with thousands separators in it arrives as
 * text. The PDF prints the grouped figure and the CSV carries the value; both come from the same
 * section data, so they cannot disagree about the number itself. Dates are written as `2026-09-30`
 * for the same reason.
 */

/**
 * Quotes a cell, and defuses a formula.
 *
 * A description beginning `=` or `+` is executed as a formula the moment the file is opened, which
 * is a real way to attack whoever opens a report — and the description of a money entry is typed
 * by a member of staff. Prefixing an apostrophe makes the spreadsheet treat it as text. The same
 * rule as the finance export, which is where this was first needed.
 */
function cell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${guarded.replaceAll('"', '""')}"`
}

function line(values: (string | null)[]): string {
  return values.map((value) => cell(value ?? '')).join(',')
}

function rowValues(row: ReportRow, keys: string[]): (string | null)[] {
  return keys.map((key) => row[key] ?? '')
}

export function renderReportCsv(report: ReportDocument): string {
  const lines: string[] = []

  lines.push(line([report.cooperative.name, report.cooperative.code]))
  lines.push(line([report.title, report.subtitle ?? '']))
  lines.push(line([report.periodLabel, `${report.from}`, `${report.to}`]))
  lines.push(
    line([
      reportLabel(report.locale, 'report.generatedBy', { name: report.generatedBy }),
      reportLabel(report.locale, 'report.generatedAt', { when: report.generatedAtLabel }),
    ]),
  )

  for (const section of report.sections) {
    lines.push('')
    lines.push(line([section.title]))

    switch (section.kind) {
      case 'figures':
        for (const figure of section.figures) {
          lines.push(line([figure.label, figure.value, figure.hint ?? '']))
        }
        break

      case 'table': {
        const keys = section.columns.map((column) => column.key)
        lines.push(line(section.columns.map((column) => column.label)))
        if (section.rows.length === 0) {
          lines.push(line([section.emptyLabel ?? '']))
          break
        }
        for (const row of section.rows) lines.push(line(rowValues(row, keys)))
        if (section.total) lines.push(line(rowValues(section.total, keys)))
        if (section.truncatedFrom) {
          lines.push(
            line([
              reportLabel(report.locale, 'report.truncated', {
                shown: section.rows.length,
                total: section.truncatedFrom,
              }),
            ]),
          )
        }
        break
      }

      case 'note':
      case 'withheld':
        lines.push(line([section.text]))
        break
    }
  }

  // A byte order mark, written as an escape so it is visible in the source rather than as an
  // invisible character somebody deletes by accident. Excel on Windows needs it to read the
  // Kinyarwanda characters as UTF-8; without it `imigabane y'abanyamuryango` arrives as mojibake.
  return `\ufeff${lines.join('\r\n')}\r\n`
}
