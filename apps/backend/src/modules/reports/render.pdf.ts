import {
  formatReportValue,
  reportColumnAlign,
  reportLabel,
  type ReportColumn,
  type ReportDocument,
  type ReportFigure,
  type ReportRow,
} from '@coopmanage/shared'
import PDFDocument from 'pdfkit'

/**
 * A report on A4 paper.
 *
 * Built to match `docs/ui-system.md` section 11 — the print stylesheet the receipt and every
 * printable screen already follow — so a report produced here and a page printed from the browser
 * look like documents from the same cooperative: black on white, no colour, no shading behind
 * table rows, the header repeated at the top of every page, and a footer naming the cooperative,
 * the report, the period and the page number.
 *
 * Rendered with pdfkit rather than a headless browser. A browser would have let the print
 * stylesheet do this work, but it also means shipping Chromium: a few hundred megabytes of
 * download and a quarter of a gigabyte of memory per render, on hosting a Rwandan cooperative is
 * paying for by the month. pdfkit is about a megabyte and renders this page in milliseconds.
 *
 * Nothing here decides what the report says. It walks the sections `reports.data.ts` built and
 * formats each value with `formatReportValue`, the same function the screen uses, so the printed
 * figure and the figure on screen cannot differ.
 */

/** A4 in PostScript points, and the 14mm margin the print stylesheet sets. */

const PAGE = { width: 595.28, height: 841.89 }
const MARGIN = 39.7 // 14mm
export const CONTENT_WIDTH = PAGE.width - MARGIN * 2

const FONT = 'Helvetica'
const FONT_BOLD = 'Helvetica-Bold'

const SIZE = {
  title: 15,
  subtitle: 10,
  section: 10.5,
  body: 8.5,
  small: 7.5,
  footer: 7,
}

/**
 * The band at the foot of every page, kept clear of the text area.
 *
 * Two lines: what the document is, and who produced it. The second line matters on paper filed for
 * years — a report with no name and no time on it is one nobody can place later — and it is a
 * second line rather than a longer first one because the first attempt ran the two together and
 * the result wrapped over the edge of the printable area.
 */
const FOOTER_RESERVE = 26

const ROW_GAP = 3.2
const RULE = 0.6

type Doc = PDFKit.PDFDocument

/**
 * Renders the document and resolves to the finished bytes.
 *
 * Held in memory rather than streamed to the response: a report is a few hundred kilobytes at
 * most, and buffering means a failure half way through renders an error the caller can act on
 * instead of a truncated file that looks like a corrupt download.
 */
export async function renderReportPdf(report: ReportDocument): Promise<Buffer> {
  const doc = new PDFDocument({
    size: [PAGE.width, PAGE.height],
    margins: { top: MARGIN, bottom: MARGIN + FOOTER_RESERVE, left: MARGIN, right: MARGIN },
    info: {
      Title: `${report.title} — ${report.cooperative.name}`,
      Author: report.cooperative.name,
      Subject: report.periodLabel,
      Creator: 'CoopManage Rwanda',
    },
    // Tagged for accessibility: a report filed with a cooperative's federation may be read by
    // somebody using a screen reader, and a PDF with no structure is unreadable to one.
    pdfVersion: '1.7',
    // The footer names the page and the total, and the total is not known until the last page has
    // been laid out. Buffering the pages is what lets the renderer go back and write it; without
    // it `switchToPage` silently does nothing and every page claims to be page 1 of 1, which is
    // exactly what the first probe of this renderer printed.
    bufferPages: true,
    lang: report.locale === 'RW' ? 'rw' : 'en',
    displayTitle: true,
  })

  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  drawHeader(doc, report)
  for (const section of report.sections) {
    drawSection(doc, report, section)
  }
  drawFooters(doc, report)

  // Buffered pages have to be flushed before the document is closed, or nothing written after the
  // first page reaches the file.
  doc.flushPages()
  doc.end()
  return finished
}

function drawHeader(doc: Doc, report: ReportDocument): void {
  doc.font(FONT_BOLD).fontSize(SIZE.title).fillColor('black')
  doc.text(report.cooperative.name, MARGIN, MARGIN, { width: CONTENT_WIDTH })

  doc.font(FONT).fontSize(SIZE.small)
  doc.text(
    `${report.cooperative.district} · ${report.cooperative.sector} · ${report.cooperative.code}`,
    { width: CONTENT_WIDTH },
  )

  doc.moveDown(0.6)
  doc.font(FONT_BOLD).fontSize(SIZE.subtitle + 1.5)
  doc.text(report.title, { width: CONTENT_WIDTH })

  doc.font(FONT).fontSize(SIZE.subtitle)
  if (report.subtitle) doc.text(report.subtitle, { width: CONTENT_WIDTH })
  doc.text(report.periodLabel, { width: CONTENT_WIDTH })

  doc.moveDown(0.3)
  rule(doc, 1)
  doc.moveDown(0.5)
}

function rule(doc: Doc, weight = RULE): void {
  const y = doc.y
  doc
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + CONTENT_WIDTH, y)
    .lineWidth(weight)
    .strokeColor('black')
    .stroke()
  doc.y = y + 2
}

/** Starts a new page when what comes next would not fit, so a heading never ends a page alone. */
function ensureSpace(doc: Doc, needed: number): void {
  if (doc.y + needed > pageBottom()) doc.addPage()
}

function sectionHeading(doc: Doc, title: string): void {
  ensureSpace(doc, 40)
  doc.moveDown(0.5)
  doc.font(FONT_BOLD).fontSize(SIZE.section).fillColor('black')
  doc.text(title, MARGIN, doc.y, { width: CONTENT_WIDTH })
  doc.moveDown(0.2)
}

function drawSection(
  doc: Doc,
  report: ReportDocument,
  section: ReportDocument['sections'][number],
): void {
  switch (section.kind) {
    case 'figures':
      sectionHeading(doc, section.title)
      drawFigures(doc, report, section.figures)
      break
    case 'table':
      sectionHeading(doc, section.title)
      drawTable(doc, report, section)
      break
    case 'note':
    case 'withheld':
      sectionHeading(doc, section.title)
      doc.font(FONT).fontSize(SIZE.body).fillColor('black')
      doc.text(section.text, MARGIN, doc.y, { width: CONTENT_WIDTH })
      doc.moveDown(0.3)
      break
  }
}

/**
 * Headline figures, in a grid of three.
 *
 * The label goes above the figure and the figure is set in bold at a larger size, which is how the
 * same block is arranged on the dashboard. Three to a row is what fits A4 without the numbers
 * crowding: five figures — the finance block — become a row of three and a row of two, and the
 * second row is left-aligned under the first rather than spread, so the eye still reads down a
 * column.
 */
function drawFigures(doc: Doc, report: ReportDocument, items: ReportFigure[]): void {
  const perRow = 3
  const gap = 12
  const cellWidth = (CONTENT_WIDTH - gap * (perRow - 1)) / perRow

  for (let index = 0; index < items.length; index += perRow) {
    const row = items.slice(index, index + perRow)
    const heights = row.map((figure) => (figure.hint ? 40 : 30))
    ensureSpace(doc, Math.max(...heights) + 6)
    const top = doc.y

    row.forEach((figure, column) => {
      const x = MARGIN + column * (cellWidth + gap)
      doc.font(FONT).fontSize(SIZE.small).fillColor('black')
      doc.text(figure.label, x, top, { width: cellWidth })
      doc.font(FONT_BOLD).fontSize(SIZE.section + 1)
      doc.text(
        formatReportValue(figure.type, figure.value, {
          locale: report.locale,
          currency: report.currency,
        }),
        x,
        top + 10,
        { width: cellWidth },
      )
      if (figure.hint) {
        doc.font(FONT).fontSize(SIZE.footer)
        doc.text(figure.hint, x, top + 24, { width: cellWidth })
      }
    })

    doc.y = top + Math.max(...heights)
  }
}

type TableSection = Extract<ReportDocument['sections'][number], { kind: 'table' }>

interface Cell {
  column: ReportColumn
  x: number
  width: number
}

/**
 * Divides the printable width between the columns.
 *
 * A first version simply split the width by each column's stated weight, and the proof that this
 * was not enough is in the first probe of this renderer: a reference broke as `FIN-2026-09-000` /
 * `1` and a date as `1 September` / `2026`, because both columns were a few points short. A
 * wrapped date is merely ugly; a reference broken across two lines is a document somebody copies
 * the wrong number out of.
 *
 * So the width each column actually needs is measured first, along with the narrowest it can be
 * without breaking a word. Columns that fit get exactly what they need; the width left over goes
 * to the columns that cannot fit — the descriptions and the names — which wrap, because that is
 * what prose is supposed to do. The weight still settles the order of generosity; it is no longer
 * the whole answer.
 */
function layoutOf(doc: Doc, report: ReportDocument, section: TableSection): Cell[] {
  const columns = section.columns
  const rows = section.total ? [...section.rows, section.total] : section.rows

  const demand: number[] = []
  const minimum: number[] = []

  for (const column of columns) {
    doc.font(FONT_BOLD).fontSize(SIZE.small)
    let widest = doc.widthOfString(column.label)
    let longestWord = widestWord(doc, column.label)

    doc.font(FONT).fontSize(SIZE.body)
    for (const row of rows) {
      const text = formatReportValue(column.type, row[column.key] ?? null, {
        locale: report.locale,
        currency: report.currency,
      })
      widest = Math.max(widest, doc.widthOfString(text))
      longestWord = Math.max(longestWord, widestWord(doc, text))
    }

    demand.push(widest + CELL_PADDING * 2 + 1)
    minimum.push(longestWord + CELL_PADDING * 2 + 1)
  }

  const weights = columns.map((column) => column.weight ?? 1)
  const widths = shareColumnWidths(demand, minimum, weights, CONTENT_WIDTH)

  let x = MARGIN
  return columns.map((column, index) => {
    const cell = { column, x, width: widths[index] ?? 0 }
    x += widths[index] ?? 0
    return cell
  })
}

/**
 * The widest single word, which is the narrowest a column can be without breaking one in half.
 *
 * The member register proved this necessary: `Inomero y’umunyamuryango` is a long heading, its
 * column was given a share by weight, and pdfkit split the word as `Inomero y’umun` / `yamuryango`.
 * A wrapped heading is fine; a word cut in two on a sheet a cooperative files is not.
 */
function widestWord(doc: Doc, text: string): number {
  let widest = 0
  for (const word of text.split(/\s+/)) {
    if (word.length === 0) continue
    widest = Math.max(widest, doc.widthOfString(word))
  }
  return widest
}

/**
 * Divides the available width between the columns.
 *
 * Every column is first given the narrowest it can be without breaking a word. Only then is what
 * remains handed out, by weight, to the columns that want more — and never more than they asked
 * for, so a column of dates does not end up twice as wide as the longest date in it.
 *
 * The order matters, and the register report is the proof. An earlier version handed each column
 * its full demand as soon as the page could afford it, which starved whichever column was settled
 * last: the member-code column was left 67 points for a heading needing 102, and pdfkit cut
 * `Inomero y’umunyamuryango` into `Inomero y’umun` and `yamuryango` on a sheet a cooperative
 * files. Reserving the minimums first cannot do that, because a column is never given less than
 * its longest word while the page has room for every column's.
 *
 * Where even the longest words do not fit — a table genuinely too wide for A4 — the weights decide
 * alone and a word may break. That is the honest outcome, and better than a column running off the
 * edge of the paper.
 */
export function shareColumnWidths(
  demand: number[],
  minimum: number[],
  weights: number[],
  available: number,
): number[] {
  const totalWeight = weights.reduce((running, weight) => running + weight, 0)
  const byWeight = (left: number, indices: number[]): number[] => {
    const weight = indices.reduce((running, index) => running + (weights[index] ?? 1), 0)
    return indices.map((index) => (left * (weights[index] ?? 1)) / weight)
  }

  const totalMinimum = minimum.reduce((running, width) => running + width, 0)
  if (totalMinimum > available) {
    const all = [...weights.keys()]
    const portions = byWeight(available, all)
    return all.map((index) => portions[index] ?? 0)
  }

  const widths = [...minimum]
  let left = available - totalMinimum

  // Handed out in rounds. A column that reaches its demand drops out and its unused share goes
  // back into the pool, which is what keeps a narrow column from hoarding width it cannot use.
  for (let round = 0; round < weights.length + 1 && left > 0.01; round += 1) {
    const hungry = [...widths.keys()].filter(
      (index) => (widths[index] ?? 0) < (demand[index] ?? 0) - 0.01,
    )
    if (hungry.length === 0) break

    const portions = byWeight(left, hungry)
    let handed = 0
    hungry.forEach((index, position) => {
      const want = (demand[index] ?? 0) - (widths[index] ?? 0)
      const give = Math.min(want, portions[position] ?? 0)
      widths[index] = (widths[index] ?? 0) + give
      handed += give
    })
    if (handed < 0.01) break
    left -= handed
  }

  // Every column has what it asked for and there is paper left over. Spreading it by weight keeps
  // a narrow table filling the page rather than huddling against the left margin.
  if (left > 0.01) {
    return widths.map((width, index) => width + (left * (weights[index] ?? 1)) / totalWeight)
  }
  return widths
}

const CELL_PADDING = 3

function cellText(report: ReportDocument, cell: Cell, row: ReportRow): string {
  return formatReportValue(cell.column.type, row[cell.column.key] ?? null, {
    locale: report.locale,
    currency: report.currency,
  })
}

/** The bottom of the printable area, above the space the footer is written into. */
function pageBottom(): number {
  return PAGE.height - MARGIN - FOOTER_RESERVE
}

/**
 * How tall a row will be once every cell has wrapped.
 *
 * Measured before anything is drawn, so each cell in the row starts at the same top and the row is
 * as tall as its longest cell. A description that wraps onto two lines must not overlap the row
 * below it, which is exactly what happens if the cells are simply drawn one after another.
 */
function rowHeight(
  doc: Doc,
  report: ReportDocument,
  cells: Cell[],
  row: ReportRow,
  bold: boolean,
): number {
  doc.font(bold ? FONT_BOLD : FONT).fontSize(SIZE.body)
  const heights = cells.map((cell) =>
    doc.heightOfString(cellText(report, cell, row), { width: cell.width - CELL_PADDING * 2 }),
  )
  return Math.max(...heights, SIZE.body + 1)
}

function drawRowAt(
  doc: Doc,
  report: ReportDocument,
  cells: Cell[],
  row: ReportRow,
  top: number,
  bold: boolean,
): void {
  doc
    .font(bold ? FONT_BOLD : FONT)
    .fontSize(SIZE.body)
    .fillColor('black')
  for (const cell of cells) {
    doc.text(cellText(report, cell, row), cell.x + CELL_PADDING, top, {
      width: cell.width - CELL_PADDING * 2,
      align: reportColumnAlign(cell.column),
    })
  }
}

function headerRowHeight(doc: Doc, cells: Cell[]): number {
  doc.font(FONT_BOLD).fontSize(SIZE.small)
  const heights = cells.map((cell) =>
    doc.heightOfString(cell.column.label, { width: cell.width - CELL_PADDING * 2 }),
  )
  return Math.max(...heights, SIZE.small + 1) + 6
}

function drawHeaderRow(doc: Doc, cells: Cell[]): void {
  doc.font(FONT_BOLD).fontSize(SIZE.small).fillColor('black')
  const top = doc.y
  const heights = cells.map((cell) =>
    doc.heightOfString(cell.column.label, { width: cell.width - CELL_PADDING * 2 }),
  )
  for (const cell of cells) {
    doc.text(cell.column.label, cell.x + CELL_PADDING, top, {
      width: cell.width - CELL_PADDING * 2,
      align: reportColumnAlign(cell.column),
    })
  }
  doc.y = top + Math.max(...heights, SIZE.small + 1) + 2
  rule(doc)
  doc.y += 2
}

/**
 * A table, paginated by hand.
 *
 * Rows are measured and placed rather than left to pdfkit's own text flow, for two reasons. A row
 * never straddles a page break, which on paper is the difference between a figure that can be read
 * and one that has to be pieced together; and the column header is drawn again at the top of every
 * page the table continues onto, which is what `thead { display: table-header-group }` does in the
 * print stylesheet. A page of figures with no column names on it is a page somebody misreads.
 */
function drawTable(doc: Doc, report: ReportDocument, section: TableSection): void {
  if (section.rows.length === 0) {
    doc.font(FONT).fontSize(SIZE.body).fillColor('black')
    doc.text(section.emptyLabel ?? '', MARGIN, doc.y, { width: CONTENT_WIDTH })
    doc.moveDown(0.4)
    return
  }

  const cells = layoutOf(doc, report, section)
  const headerHeight = headerRowHeight(doc, cells)

  // The heading must not be the last thing on a page: the header row and at least one row of
  // figures have to fit under it or the whole table starts on the next page.
  if (doc.y + headerHeight + 24 > pageBottom()) doc.addPage()
  drawHeaderRow(doc, cells)

  const rows = section.total ? [...section.rows, section.total] : section.rows

  rows.forEach((row, index) => {
    const isTotal = Boolean(section.total) && index === rows.length - 1
    const height = rowHeight(doc, report, cells, row, isTotal)

    if (doc.y + height + ROW_GAP > pageBottom()) {
      doc.addPage()
      drawHeaderRow(doc, cells)
    }

    if (isTotal) {
      rule(doc)
      doc.y += 2
    }

    const top = doc.y
    drawRowAt(doc, report, cells, row, top, isTotal)
    doc.y = top + height + ROW_GAP
  })

  if (section.truncatedFrom) {
    doc.font(FONT).fontSize(SIZE.footer).fillColor('black')
    doc.text(
      reportLabel(report.locale, 'report.truncated', {
        shown: section.rows.length,
        total: section.truncatedFrom,
      }),
      MARGIN,
      doc.y + 2,
      { width: CONTENT_WIDTH },
    )
    doc.moveDown(0.4)
  }
}

/**
 * The footer, written onto every page once the page count is known.
 *
 * pdfkit can only do this at the end: the page number of the last page is not known while the
 * first is being drawn. `bufferedPages` is what makes it possible at all, and it is the reason the
 * document is buffered rather than streamed.
 */
function drawFooters(doc: Doc, report: ReportDocument): void {
  const range = doc.bufferedPageRange()
  const left = [report.cooperative.name, report.title, report.periodLabel].join(' · ')

  const pageLabelWidth = 64
  const produced = [
    reportLabel(report.locale, 'report.generatedBy', { name: report.generatedBy }),
    reportLabel(report.locale, 'report.generatedAt', { when: report.generatedAtLabel }),
  ].join(' · ')

  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index)

    // The footer is written below the text area, in the band between it and the paper's own
    // margin. pdfkit treats any text written past the bottom margin as an overflow and starts a
    // new page for it, which is how the first version of this renderer turned a two-page report
    // into six pages, each carrying nothing but a footer. Dropping the bottom margin for the
    // duration is the documented way to write into that band; it is restored immediately.
    const margins = doc.page.margins
    const bottom = margins.bottom
    margins.bottom = 0

    const first = PAGE.height - MARGIN - 20
    const second = first + 9

    doc
      .moveTo(MARGIN, first - 5)
      .lineTo(MARGIN + CONTENT_WIDTH, first - 5)
      .lineWidth(RULE)
      .strokeColor('black')
      .stroke()

    doc.font(FONT).fontSize(SIZE.footer).fillColor('black')
    doc.text(left, MARGIN, first, {
      width: CONTENT_WIDTH - pageLabelWidth,
      lineBreak: false,
      ellipsis: true,
    })
    doc.text(
      reportLabel(report.locale, 'report.page', { page: `${index + 1}/${range.count}` }),
      MARGIN + CONTENT_WIDTH - pageLabelWidth,
      first,
      { width: pageLabelWidth, align: 'right', lineBreak: false },
    )
    doc.text(produced, MARGIN, second, {
      width: CONTENT_WIDTH,
      lineBreak: false,
      ellipsis: true,
    })

    margins.bottom = bottom
  }
}
