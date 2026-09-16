import { Table2 } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '@coopmanage/shared'
import { Button, Money, Panel } from '@/components/ui'
import { barPercent, largestMinorUnits } from '@/lib/chartGeometry'
import { cn } from '@/lib/cn'
import type { DashboardChart } from './dashboard.api'

/**
 * The three charts the design system allows, and nothing else.
 *
 * **Drawn by hand.** No charting package is installed, the content-security policy does not permit
 * one from a CDN, and a bar is a `div` with a height. `docs/ui-system.md` §10 sets the rules and
 * they are followed here: direct labels rather than a legend, axes from zero, no dual axes, no
 * animation beyond a fade, and **every chart has a table equivalent reachable in one click**.
 *
 * That table is not an afterthought for compliance. It is always in the document, so a screen
 * reader reads the figures rather than a decorative shape, and the button only changes whether it
 * is also visible. The bars themselves are `aria-hidden`, because a row of divs read aloud is
 * noise.
 *
 * **No figure a reader sees comes from the geometry.** Heights are integer ratios of exact minor
 * units; every amount printed is rendered from the original decimal string.
 */

function ChartFrame({
  title,
  description,
  table,
  children,
}: {
  title: string
  description?: string
  table: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation('dashboard')
  const [showTable, setShowTable] = useState(false)
  const tableId = useId()

  return (
    <Panel
      title={title}
      description={description}
      actions={
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<Table2 aria-hidden="true" className="size-4" />}
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable((current) => !current)}
        >
          {showTable ? t('charts.hideTable') : t('charts.showTable')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {children}
        {/*
          Present in the document whether or not it is shown, so a screen reader always has the
          figures. `sr-only` hides it from sight without hiding it from the accessibility tree,
          which `hidden` would.
        */}
        <div id={tableId} className={showTable ? undefined : 'sr-only'}>
          {table}
        </div>
      </div>
    </Panel>
  )
}

function FigureTable({
  caption,
  columns,
  rows,
}: {
  caption: string
  columns: string[]
  rows: { label: string; values: ReactNode[] }[]
}) {
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-line text-left">
          {columns.map((column) => (
            <th
              key={column}
              scope="col"
              className={cn(
                'py-1.5 font-semibold',
                column === columns[0] ? 'pr-3' : 'pl-3 text-right',
              )}
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-b border-line last:border-0">
            <th scope="row" className="py-1.5 pr-3 text-left font-normal">
              {row.label}
            </th>
            {row.values.map((value, index) => (
              <td key={index} className="py-1.5 pl-3 text-right tabular-nums">
                {value}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** A month bucket (`2026-09`) written in the reader's language. */
function useMonthLabel(): (bucket: string) => string {
  const { i18n } = useTranslation()
  return (bucket: string) => {
    const [year, month] = bucket.split('-')
    if (!year || !month) return bucket
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1))
    return new Intl.DateTimeFormat(i18n.language === 'rw' ? 'rw' : 'en', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    }).format(date)
  }
}

/**
 * Twelve months of money in against money out.
 *
 * Grouped bars rather than two lines, because the question is a comparison within each month — did
 * more come in than went out in March — not a trend across them. An empty month keeps a sliver of a
 * bar, because a gap in a row reads as missing data rather than as nothing having happened.
 */
export function IncomeExpenseChart({ chart }: { chart: DashboardChart }) {
  const { t } = useTranslation('dashboard')
  const label = useMonthLabel()

  const largest = largestMinorUnits(
    chart.points.flatMap((point) => [point.values.income ?? '0', point.values.expenses ?? '0']),
  )

  return (
    <ChartFrame
      title={t('charts.incomeExpense.title')}
      description={t('charts.incomeExpense.description')}
      table={
        <FigureTable
          caption={t('charts.incomeExpense.caption')}
          columns={[t('charts.month'), t('charts.income'), t('charts.expenses')]}
          rows={chart.points.map((point) => ({
            label: label(point.bucket),
            values: [
              <Money key="in" value={point.values.income ?? '0'} withCurrency={false} />,
              <Money key="out" value={point.values.expenses ?? '0'} withCurrency={false} />,
            ],
          }))}
        />
      }
    >
      {/* Direct labels, no legend: two series, so the colour is named beside the bars. */}
      <div className="flex items-center gap-4 text-sm">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 rounded-sm bg-success-fg" />
          {t('charts.income')}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 rounded-sm bg-danger-fg" />
          {t('charts.expenses')}
        </span>
      </div>

      <div
        aria-hidden="true"
        className="flex h-40 items-end gap-2 motion-safe:animate-[fade_150ms]"
      >
        {chart.points.map((point) => (
          <div key={point.bucket} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-32 w-full items-end justify-center gap-0.5">
              <div
                className="w-1/2 rounded-t-sm bg-success-fg"
                style={{
                  height: `${Math.max(barPercent(point.values.income ?? '0', largest), 1.5)}%`,
                }}
              />
              <div
                className="w-1/2 rounded-t-sm bg-danger-fg"
                style={{
                  height: `${Math.max(barPercent(point.values.expenses ?? '0', largest), 1.5)}%`,
                }}
              />
            </div>
            <span className="text-xs text-ink-muted">{label(point.bucket)}</span>
          </div>
        ))}
      </div>
    </ChartFrame>
  )
}

/**
 * Six months of sales, with the six before them ghosted behind.
 *
 * A **line**, because the question is a trend — are we selling more or less than before — and a
 * trend is what a line is for. The previous period is a paler line behind it rather than a second
 * series in the legend: the comparison is the point, since "four million francs" means nothing
 * alone and "four million against three and a half last half-year" is a sentence a manager can act
 * on. `docs/ui-system.md` §10 specifies both.
 *
 * Drawn as an SVG path from the same exact integer ratios the bars use, with
 * `vector-effect="non-scaling-stroke"` so the line keeps an even width when the viewBox is
 * stretched to the width of the panel. Each point sits at the centre of its month's column, which
 * is what lets the labels below line up with it exactly.
 */
export function SalesTrendChart({ chart }: { chart: DashboardChart }) {
  const { t } = useTranslation('dashboard')
  const label = useMonthLabel()

  const largest = largestMinorUnits(
    chart.points.flatMap((point) => [point.values.sold ?? '0', point.values.previous ?? '0']),
  )

  /** The viewBox. Arbitrary units: the panel decides the real size. */
  const WIDTH = 600
  const HEIGHT = 160
  const TOP = 12
  const BOTTOM = 8

  const count = chart.points.length
  const x = (index: number): number => ((index + 0.5) / count) * WIDTH
  const y = (value: string): number =>
    HEIGHT - BOTTOM - (barPercent(value, largest) / 100) * (HEIGHT - TOP - BOTTOM)

  const path = (series: 'sold' | 'previous'): string =>
    chart.points
      .map(
        (point, index) => `${index === 0 ? 'M' : 'L'}${x(index)} ${y(point.values[series] ?? '0')}`,
      )
      .join(' ')

  return (
    <ChartFrame
      title={t('charts.sales.title')}
      description={t('charts.sales.description')}
      table={
        <FigureTable
          caption={t('charts.sales.caption')}
          columns={[t('charts.month'), t('charts.sold'), t('charts.previousPeriod')]}
          rows={chart.points.map((point) => ({
            label: label(point.bucket),
            values: [
              <Money key="now" value={point.values.sold ?? '0'} withCurrency={false} />,
              <Money key="was" value={point.values.previous ?? '0'} withCurrency={false} />,
            ],
          }))}
        />
      }
    >
      <div className="flex items-center gap-4 text-sm">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-0.5 w-4 rounded-full bg-primary-600" />
          {t('charts.sold')}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-0.5 w-4 rounded-full bg-primary-200" />
          {t('charts.previousPeriod')}
        </span>
      </div>

      {count === 0 ? null : (
        <div aria-hidden="true" className="flex flex-col gap-1 motion-safe:animate-[fade_150ms]">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            className="h-40 w-full"
            role="presentation"
          >
            {/* The zero line, so the reader can see the axis starts there. */}
            <line
              x1="0"
              y1={HEIGHT - BOTTOM}
              x2={WIDTH}
              y2={HEIGHT - BOTTOM}
              className="stroke-line"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={path('previous')}
              fill="none"
              className="stroke-primary-200"
              strokeWidth="2"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={path('sold')}
              fill="none"
              className="stroke-primary-600"
              strokeWidth="2"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {/*
              A dot per month on the current line. With six points a reader cannot otherwise tell
              where a month sits on the line, and a month with no sales would look like part of a
              slope rather than a month with no sales.
            */}
            {chart.points.map((point, index) => (
              <circle
                key={point.bucket}
                cx={x(index)}
                cy={y(point.values.sold ?? '0')}
                r="3"
                className="fill-primary-600"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <div className="flex">
            {chart.points.map((point) => (
              <span key={point.bucket} className="flex-1 text-center text-xs text-ink-muted">
                {label(point.bucket)}
              </span>
            ))}
          </div>
        </div>
      )}
    </ChartFrame>
  )
}

/**
 * Where this month's money went: the six largest categories, then everything else as one.
 *
 * Horizontal bars, because a category name is words and words read across. Six and an "Other" is
 * the most this says clearly; beyond that a reader is reading a table with decoration, and the
 * table is one click away anyway.
 */
export function ExpensesByCategoryChart({ chart }: { chart: DashboardChart }) {
  const { t } = useTranslation('dashboard')
  const { i18n } = useTranslation()

  const name = (point: { bucket: string; values: Record<string, string> }): string => {
    if (point.bucket === 'other') return t('charts.expensesByCategory.other')
    // The cooperative's own Kinyarwanda name for the category where it gave one.
    return i18n.language === 'rw' && point.values.nameRw ? point.values.nameRw : point.bucket
  }

  const largest = largestMinorUnits(chart.points.map((point) => point.values.amount ?? '0'))

  return (
    <ChartFrame
      title={t('charts.expensesByCategory.title')}
      description={t('charts.expensesByCategory.description')}
      table={
        <FigureTable
          caption={t('charts.expensesByCategory.caption')}
          columns={[t('charts.category'), t('charts.amount')]}
          rows={chart.points.map((point) => ({
            label: name(point),
            values: [
              <Money key="amount" value={point.values.amount ?? '0'} withCurrency={false} />,
            ],
          }))}
        />
      }
    >
      {chart.points.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('charts.expensesByCategory.empty')}</p>
      ) : (
        <ul aria-hidden="true" className="flex flex-col gap-2 motion-safe:animate-[fade_150ms]">
          {chart.points.map((point) => (
            <li key={point.bucket} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-sm text-ink">{name(point)}</span>
              <span className="h-4 flex-1 overflow-hidden rounded-sm bg-surface-subtle">
                <span
                  className="block h-full rounded-sm bg-accent-600"
                  style={{
                    width: `${Math.max(barPercent(point.values.amount ?? '0', largest), 1.5)}%`,
                  }}
                />
              </span>
              <span className="w-28 shrink-0 text-right text-sm tabular-nums text-ink">
                {formatMoney(point.values.amount ?? '0', { withCurrency: false })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ChartFrame>
  )
}
