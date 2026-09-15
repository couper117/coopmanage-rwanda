import type { ReportColumn, ReportDocument, ReportRow } from '@coopmanage/shared'
import { reportLabel } from '@coopmanage/shared'
import writeXlsxFile, { type SheetData } from 'write-excel-file/node'

/**
 * A report as a real spreadsheet.
 *
 * The difference from the CSV is that money arrives as a **number with a currency format** rather
 * than as text, so selecting a column and reading the sum works — which is the whole reason a
 * cooperative's treasurer asks for a spreadsheet instead of the PDF.
 *
 * Converting money to a JavaScript number is safe here and only here. A double carries 15 to 17
 * significant digits and the amount columns hold at most 14, so every value the database can store
 * survives the conversion exactly. It happens at the very end, on a value that has already been
 * added up with the decimal library, and nothing is computed from it afterwards. The same
 * reasoning is written out in the finance export, which was the first place it was needed.
 */

type Cell = NonNullable<SheetData[number][number]>

const HEADER_FILL = '#F1F5F9'

function amountAsNumber(value: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`a report tried to write ${value} into a spreadsheet as a number`)
  }
  return parsed
}

function titleRow(text: string): Cell[] {
  return [{ value: text, fontWeight: 'bold', type: String }]
}

function valueCell(column: ReportColumn, raw: string | null, bold: boolean): Cell {
  const common = bold ? { fontWeight: 'bold' as const } : {}

  if (raw === null || raw === '') return { ...common, type: String, value: '' }

  switch (column.type) {
    case 'money':
      return { ...common, type: Number, value: amountAsNumber(raw), format: '#,##0.00' }
    case 'quantity':
      return { ...common, type: Number, value: amountAsNumber(raw), format: '#,##0.000' }
    case 'number':
      return { ...common, type: Number, value: amountAsNumber(raw), format: '#,##0' }
    case 'date':
      // Written as a real date so a reader can sort and filter by it. The value is date-only, so
      // it is anchored at midnight UTC rather than in the server's own timezone — otherwise a
      // report produced in Europe would show a Rwandan cooperative the day before.
      return {
        ...common,
        type: Date,
        value: new Date(`${raw}T00:00:00.000Z`),
        format: 'yyyy-mm-dd',
      }
    case 'text':
      return { ...common, type: String, value: raw }
  }
}

function tableRow(columns: ReportColumn[], row: ReportRow, bold = false): Cell[] {
  return columns.map((column) => valueCell(column, row[column.key] ?? null, bold))
}

export async function renderReportXlsx(report: ReportDocument): Promise<Buffer> {
  const data: SheetData = []

  data.push([{ value: report.cooperative.name, fontWeight: 'bold', type: String, fontSize: 14 }])
  data.push([
    {
      value: `${report.cooperative.district} · ${report.cooperative.sector} · ${report.cooperative.code}`,
      type: String,
    },
  ])
  data.push(titleRow(report.title))
  if (report.subtitle) data.push([{ value: report.subtitle, type: String }])
  data.push([{ value: report.periodLabel, type: String }])
  data.push([
    {
      value: [
        reportLabel(report.locale, 'report.generatedBy', { name: report.generatedBy }),
        reportLabel(report.locale, 'report.generatedAt', { when: report.generatedAtLabel }),
      ].join(' · '),
      type: String,
    },
  ])

  /** The widest row decides the column widths, so a narrow header does not squeeze a wide table. */
  let widest = 1

  for (const section of report.sections) {
    data.push([])
    data.push(titleRow(section.title))

    switch (section.kind) {
      case 'figures':
        for (const figure of section.figures) {
          data.push([
            { value: figure.label, type: String },
            valueCell({ key: 'v', label: '', type: figure.type }, figure.value, false),
            ...(figure.hint ? [{ value: figure.hint, type: String } satisfies Cell] : []),
          ])
        }
        widest = Math.max(widest, 3)
        break

      case 'table': {
        data.push(
          section.columns.map((column) => ({
            value: column.label,
            fontWeight: 'bold' as const,
            backgroundColor: HEADER_FILL,
            type: String,
          })),
        )
        if (section.rows.length === 0) {
          data.push([{ value: section.emptyLabel ?? '', type: String }])
        }
        for (const row of section.rows) data.push(tableRow(section.columns, row))
        if (section.total) data.push(tableRow(section.columns, section.total, true))
        if (section.truncatedFrom) {
          data.push([
            {
              value: reportLabel(report.locale, 'report.truncated', {
                shown: section.rows.length,
                total: section.truncatedFrom,
              }),
              type: String,
            },
          ])
        }
        widest = Math.max(widest, section.columns.length)
        break
      }

      case 'note':
      case 'withheld':
        data.push([{ value: section.text, type: String }])
        break
    }
  }

  const columns = Array.from({ length: widest }, (_, index) => ({ width: index === 0 ? 26 : 18 }))

  // No file path and no stream, so the writer hands back an object whose `toBuffer` resolves to
  // the finished workbook. A cooperative's report is a few thousand rows at most.
  return writeXlsxFile(data, {
    columns,
    sheet: report.title.slice(0, 31),
  }).toBuffer()
}
