import { reportLabel, type ReportDocument, type ReportRow } from '@coopmanage/shared'
import { csvRow } from '../../lib/csv.js'

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

function rowValues(row: ReportRow, keys: string[]): (string | null)[] {
  return keys.map((key) => row[key] ?? '')
}

export function renderReportCsv(report: ReportDocument): string {
  const lines: string[] = []

  lines.push(csvRow([report.cooperative.name, report.cooperative.code]))
  lines.push(csvRow([report.title, report.subtitle ?? '']))
  lines.push(csvRow([report.periodLabel, `${report.from}`, `${report.to}`]))
  lines.push(
    csvRow([
      reportLabel(report.locale, 'report.generatedBy', { name: report.generatedBy }),
      reportLabel(report.locale, 'report.generatedAt', { when: report.generatedAtLabel }),
    ]),
  )

  for (const section of report.sections) {
    lines.push('')
    lines.push(csvRow([section.title]))

    switch (section.kind) {
      case 'figures':
        for (const figure of section.figures) {
          lines.push(csvRow([figure.label, figure.value, figure.hint ?? '']))
        }
        break

      case 'table': {
        const keys = section.columns.map((column) => column.key)
        lines.push(csvRow(section.columns.map((column) => column.label)))
        if (section.rows.length === 0) {
          lines.push(csvRow([section.emptyLabel ?? '']))
          break
        }
        for (const row of section.rows) lines.push(csvRow(rowValues(row, keys)))
        if (section.total) lines.push(csvRow(rowValues(section.total, keys)))
        if (section.truncatedFrom) {
          lines.push(
            csvRow([
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
        lines.push(csvRow([section.text]))
        break
    }
  }

  // A byte order mark, written as an escape so it is visible in the source rather than as an
  // invisible character somebody deletes by accident. Excel on Windows needs it to read the
  // Kinyarwanda characters as UTF-8; without it `imigabane y'abanyamuryango` arrives as mojibake.
  return `\ufeff${lines.join('\r\n')}\r\n`
}
