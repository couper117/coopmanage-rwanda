import {
  formatReportValue,
  reportColumnAlign,
  type ReportDocument,
  type ReportSection,
} from '@coopmanage/shared'
import { useTranslation } from 'react-i18next'
import { Alert } from '@/components/ui'

/**
 * A report on screen.
 *
 * This walks the sections the server built and formats every value with `formatReportValue`, which
 * is the same function the PDF renderer uses. That is the whole point of the arrangement: the
 * figure read on the screen and the figure on the paper come from one function over one structure,
 * so they cannot differ. The screen decides nothing about what a report says.
 *
 * It is also built for paper in its own right. `docs/ui-system.md` section 11 sets the print rules
 * and they are followed here: the shell is removed by the print stylesheet, tables repeat their
 * header across pages, and a withheld section is a sentence rather than a coloured panel — because
 * a coloured panel carries nothing on paper and a photocopy carries less.
 */
export function ReportView({ report }: { report: ReportDocument }) {
  const { t } = useTranslation('reports')

  return (
    <article className="flex flex-col gap-6 rounded-lg border border-line bg-surface p-5 text-ink print:gap-4 print:rounded-none print:border-0 print:bg-white print:p-0 print:text-black">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4 print:border-black">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{report.cooperative.name}</h2>
          <p className="mt-0.5 text-sm text-ink-muted print:text-black">
            {[report.cooperative.district, report.cooperative.sector, report.cooperative.code].join(
              ' · ',
            )}
          </p>
        </div>
        <div className="sm:text-right">
          <p className="text-base font-semibold">{report.title}</p>
          {report.subtitle ? <p className="text-sm">{report.subtitle}</p> : null}
          <p className="text-sm text-ink-muted print:text-black">{report.periodLabel}</p>
        </div>
      </header>

      {/*
        Named once at the top as well as in place, so somebody about to print knows what will be
        missing from the paper before they press the button rather than afterwards.
      */}
      {report.withheld.length > 0 ? (
        <Alert tone="info">
          {t('view.withheldSummary', { sections: report.withheld.join(', ') })}
        </Alert>
      ) : null}

      {report.sections.map((section) => (
        <Section key={section.key} report={report} section={section} />
      ))}

      <footer className="border-t border-line pt-3 text-xs text-ink-muted print:border-black print:text-black">
        <p>{t('view.producedBy', { name: report.generatedBy })}</p>
        <p>{t('view.producedAt', { when: report.generatedAtLabel })}</p>
      </footer>
    </article>
  )
}

function Section({
  report,
  section,
}: {
  report: ReportDocument
  section: ReportSection & { title: string }
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted print:text-black">
        {section.title}
      </h3>
      {section.kind === 'figures' ? <Figures report={report} section={section} /> : null}
      {section.kind === 'table' ? (
        <Table report={report} section={section} sectionTitle={section.title} />
      ) : null}
      {section.kind === 'note' || section.kind === 'withheld' ? (
        <p className="text-sm text-ink">{section.text}</p>
      ) : null}
    </section>
  )
}

function Figures({
  report,
  section,
}: {
  report: ReportDocument
  section: Extract<ReportSection, { kind: 'figures' }>
}) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
      {section.figures.map((figure) => (
        <div key={figure.key}>
          <dt className="text-sm text-ink-muted print:text-black">{figure.label}</dt>
          <dd
            data-numeric={figure.type === 'text' ? undefined : ''}
            className="mt-0.5 text-lg font-semibold tabular-nums"
          >
            {formatReportValue(figure.type, figure.value, {
              locale: report.locale,
              currency: report.currency,
            })}
          </dd>
          {figure.hint ? (
            <p className="mt-0.5 text-xs text-ink-muted print:text-black">{figure.hint}</p>
          ) : null}
        </div>
      ))}
    </dl>
  )
}

/**
 * A report's table.
 *
 * Deliberately not `DataTable`: that component is built for a list a user works with — sticky
 * header, hover, click-through, a mobile card shape — and a report's table is a printed grid with
 * no rows to click. What it does share is the part that matters: a real `<caption>`, `<th
 * scope="col">`, right-aligned figures, and a header that repeats across printed pages.
 */
function Table({
  report,
  section,
  sectionTitle,
}: {
  report: ReportDocument
  section: Extract<ReportSection, { kind: 'table' }>
  sectionTitle: string
}) {
  const { t } = useTranslation('reports')

  if (section.rows.length === 0) {
    return <p className="text-sm text-ink-muted print:text-black">{section.emptyLabel}</p>
  }

  const value =
    (columnKey: string, type: (typeof section.columns)[number]['type']) => (raw: string | null) =>
      formatReportValue(type, raw, { locale: report.locale, currency: report.currency })

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{`${report.title} — ${sectionTitle}`}</caption>
        <thead className="print:table-header-group">
          <tr className="border-b border-line print:border-black">
            {section.columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={
                  reportColumnAlign(column) === 'right'
                    ? 'whitespace-nowrap py-1.5 pl-3 text-right font-semibold'
                    : 'py-1.5 pr-3 text-left font-semibold'
                }
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.rows.map((row, index) => (
            <tr
              // A report's rows have no identifier of their own — they are figures, not records —
              // so the index is the honest key here. Nothing reorders them: the server sends them
              // in the order they are printed.
              key={index}
              className="border-b border-line last:border-0 print:border-black"
            >
              {section.columns.map((column) => (
                <td
                  key={column.key}
                  className={
                    reportColumnAlign(column) === 'right'
                      ? 'whitespace-nowrap py-1.5 pl-3 text-right tabular-nums'
                      : 'py-1.5 pr-3'
                  }
                >
                  {value(column.key, column.type)(row[column.key] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {section.total ? (
          <tfoot>
            <tr className="border-t border-line font-semibold print:border-black">
              {section.columns.map((column) => (
                <td
                  key={column.key}
                  className={
                    reportColumnAlign(column) === 'right'
                      ? 'whitespace-nowrap py-1.5 pl-3 text-right tabular-nums'
                      : 'py-1.5 pr-3'
                  }
                >
                  {value(column.key, column.type)(section.total?.[column.key] ?? null)}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>

      {section.truncatedFrom ? (
        <p className="mt-1 text-xs text-ink-muted print:text-black">
          {t('view.truncated', { shown: section.rows.length, total: section.truncatedFrom })}
        </p>
      ) : null}
    </div>
  )
}
