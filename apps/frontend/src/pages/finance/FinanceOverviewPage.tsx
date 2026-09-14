import { ArrowRight, Coins } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { formatMoney } from '@coopmanage/shared'
import { PageHeader } from '@/components/PageHeader'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  FormField,
  Input,
  Money,
  Panel,
  Select,
  Skeleton,
  type Column,
  type SelectOption,
} from '@/components/ui'
import {
  EMPTY_LEDGER_FILTERS,
  GROUP_BYS,
  type CategoryBreakdownRow,
  type FinanceKind,
  type GroupBy,
  type TransactionRow,
  type TrendPoint,
} from '@/features/finance/finance.api'
import {
  barPercent,
  largestMinorUnits,
  RANGE_PRESETS,
  useCategoryLabel,
  useFinanceError,
  useFinanceRange,
  useFinanceSummary,
  useFinanceTrends,
  useFormatBucket,
  useFormatDate,
  useTransactionsList,
} from '@/features/finance/finance.hooks'

/**
 * What the cooperative has, and where it came from.
 *
 * The screen is built around one question a manager is asked at every meeting, and answers it in
 * the order the question is usually put: how much came in, how much went out, what is left; then
 * how that moved over the period; then which categories the money came from and went to; then the
 * last few entries, with a way through to the whole ledger.
 *
 * **The chart is drawn by hand, in CSS.** No charting library is installed and the CDN is not
 * reachable from a district office, so the bars are elements with a height percentage. That
 * percentage is worked out in exact integer minor units rather than in floating point, and no
 * figure the reader sees comes from it: every amount on the screen is rendered by `Money` from
 * the decimal string the server sent. The same numbers are also given as a real table, which is
 * both the accessible alternative and the only way to read a figure exactly.
 */

const HEADLINE_TONES = ['in', 'out', 'neutral'] as const

export function FinanceOverviewPage() {
  const { t } = useTranslation(['finance', 'common'])
  const describeError = useFinanceError()

  const { range, groupBy, preset, setRange, setPreset, setGroupBy } = useFinanceRange()
  const summary = useFinanceSummary(range, groupBy)
  const trends = useFinanceTrends(range, groupBy)

  // The last few entries of this same period, so the figures above and the rows below cannot
  // describe different months.
  const recent = useTransactionsList({ ...EMPTY_LEDGER_FILTERS, ...range, pageSize: 5 })

  const ledgerLink = `/finance/transactions?from=${range.from}&to=${range.to}`

  const groupOptions: SelectOption[] = GROUP_BYS.map((value) => ({
    value,
    label: t(`finance:groupBy.${value}`),
  }))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('finance:overview.title')}
        description={t('finance:overview.description')}
        actions={
          <Button variant="secondary" asChild>
            <Link to={ledgerLink}>
              {t('finance:overview.toLedger')}
              <ArrowRight aria-hidden="true" className="ml-2 size-4" />
            </Link>
          </Button>
        }
      />

      <Panel
        title={t('finance:range.title')}
        description={t('finance:range.description')}
        actions={
          <div className="flex flex-wrap gap-2">
            {RANGE_PRESETS.map((candidate) => (
              <Button
                key={candidate}
                size="sm"
                variant={preset === candidate ? 'primary' : 'secondary'}
                aria-pressed={preset === candidate}
                onClick={() => setPreset(candidate)}
              >
                {t(`finance:range.preset.${candidate}`)}
              </Button>
            ))}
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t('finance:range.from')}>
            <Input
              type="date"
              value={range.from}
              onChange={(event) => setRange({ ...range, from: event.target.value })}
            />
          </FormField>
          <FormField label={t('finance:range.to')}>
            <Input
              type="date"
              value={range.to}
              onChange={(event) => setRange({ ...range, to: event.target.value })}
            />
          </FormField>
          <FormField label={t('finance:groupBy.label')} hint={t('finance:groupBy.hint')}>
            <Select
              options={groupOptions}
              value={groupBy}
              onChange={(event) => {
                const chosen = GROUP_BYS.find((value) => value === event.target.value)
                if (chosen) setGroupBy(chosen)
              }}
            />
          </FormField>
        </div>
      </Panel>

      {summary.isError ? (
        <Alert
          tone="danger"
          title={t('finance:overview.loadFailed')}
          action={
            <Button variant="secondary" size="sm" onClick={() => void summary.refetch()}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {describeError(summary.error).message}
        </Alert>
      ) : (
        <section
          aria-label={t('finance:overview.headlineLabel')}
          className="grid gap-3 sm:grid-cols-3"
        >
          <HeadlineFigure
            label={t('finance:headline.income')}
            value={summary.data?.income}
            tone={HEADLINE_TONES[0]}
          />
          <HeadlineFigure
            label={t('finance:headline.expenses')}
            value={summary.data?.expenses}
            tone={HEADLINE_TONES[1]}
          />
          <HeadlineFigure
            label={t('finance:headline.balance')}
            value={summary.data?.closing}
            tone={HEADLINE_TONES[2]}
            hint={
              summary.data
                ? t('finance:headline.balanceHint', {
                    opening: formatMoney(summary.data.opening),
                  })
                : undefined
            }
          />
        </section>
      )}

      <MovementPanel
        points={trends.data?.points ?? []}
        groupBy={groupBy}
        loading={trends.isPending}
        error={trends.isError ? describeError(trends.error).message : null}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <CategoryBreakdown
          kind="INCOME"
          rows={summary.data?.categories ?? []}
          loading={summary.isPending}
        />
        <CategoryBreakdown
          kind="EXPENSE"
          rows={summary.data?.categories ?? []}
          loading={summary.isPending}
        />
      </div>

      <RecentEntries
        rows={recent.data?.items ?? []}
        loading={recent.isPending}
        error={recent.isError ? describeError(recent.error).message : null}
        ledgerLink={ledgerLink}
      />
    </div>
  )
}

function HeadlineFigure({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  /** Absent while the figure is still being read, which shows a shape rather than a zero. */
  value: string | undefined
  tone: 'in' | 'out' | 'neutral'
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-sm text-ink-secondary">{label}</p>
      {value === undefined ? (
        <Skeleton className="mt-1 h-8 w-32" />
      ) : (
        <p className="mt-1 text-2xl font-semibold">
          <Money value={value} tone={tone} withCurrency />
        </p>
      )}
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  )
}

/**
 * The movement over the period, as one bar per bucket for money in and one for money out.
 *
 * Deliberately plain: a bar per period, a scale the reader can see, and the same numbers written
 * out underneath. The bars are decoration over the figures rather than the figures themselves,
 * which is why each column carries an accessible label naming its period and its two amounts, and
 * why the table is always present rather than hidden behind a hover.
 */
function MovementPanel({
  points,
  groupBy,
  loading,
  error,
}: {
  points: TrendPoint[]
  groupBy: GroupBy
  loading: boolean
  error: string | null
}) {
  const { t } = useTranslation(['finance', 'common'])
  const formatBucket = useFormatBucket()

  // Both sides share one scale, so a month where twice as much went out as came in looks like it.
  const largest = largestMinorUnits(points.flatMap((point) => [point.income, point.expenses]))

  return (
    <Panel title={t('finance:movement.title')} description={t('finance:movement.description')}>
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : loading ? (
        <Skeleton className="h-48 w-full" />
      ) : points.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('finance:movement.empty')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-wrap gap-4 text-sm text-ink-secondary">
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="size-3 rounded-sm bg-success-fg" />
              {t('finance:headline.income')}
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="size-3 rounded-sm bg-danger-fg" />
              {t('finance:headline.expenses')}
            </li>
          </ul>

          <div className="overflow-x-auto">
            <div className="flex h-44 min-w-full items-end gap-2">
              {points.map((point) => (
                <div
                  key={point.start}
                  role="img"
                  aria-label={t('finance:movement.bucketLabel', {
                    period: formatBucket(point.start, groupBy),
                    income: formatMoney(point.income),
                    expenses: formatMoney(point.expenses),
                  })}
                  className="flex min-w-10 flex-1 flex-col items-center gap-1.5"
                >
                  <div
                    aria-hidden="true"
                    className="flex h-36 w-full items-end justify-center gap-1"
                  >
                    <Bar percent={barPercent(point.income, largest)} className="bg-success-fg" />
                    <Bar percent={barPercent(point.expenses, largest)} className="bg-danger-fg" />
                  </div>
                  <span className="text-xs whitespace-nowrap text-ink-muted">
                    {formatBucket(point.start, groupBy)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/*
            The same figures, exactly. A bar can only ever be read approximately, and an amount in
            a cooperative's books is not an approximate thing, so the table is part of the answer
            rather than a fallback for it.
          */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="pb-2 text-left text-sm text-ink-secondary">
                {t('finance:movement.tableCaption')}
              </caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-2 py-1.5 text-left font-medium text-ink-secondary">
                    {t('finance:movement.columns.period')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium text-ink-secondary">
                    {t('finance:headline.income')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium text-ink-secondary">
                    {t('finance:headline.expenses')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium text-ink-secondary">
                    {t('finance:movement.columns.balance')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.start} className="border-b border-line last:border-b-0">
                    <td className="px-2 py-1.5">{formatBucket(point.start, groupBy)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <Money value={point.income} tone="in" withCurrency={false} />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Money value={point.expenses} tone="out" withCurrency={false} />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Money value={point.balance} withCurrency={false} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  )
}

/**
 * One bar. An empty bucket keeps a visible sliver rather than disappearing, because a gap in a
 * row of bars reads as missing data and a period with no entries is a fact, not a gap.
 */
function Bar({ percent, className }: { percent: number; className: string }) {
  return (
    <span
      className={`w-3 rounded-t-sm ${percent === 0 ? 'bg-line-strong' : className}`}
      style={{ height: percent === 0 ? '2px' : `${percent}%` }}
    />
  )
}

/**
 * Where the money came from, or where it went.
 *
 * The share is the percentage string the server already worked out, used directly as a CSS width,
 * so the interface does no arithmetic over money to draw it.
 */
function CategoryBreakdown({
  kind,
  rows,
  loading,
}: {
  kind: FinanceKind
  rows: CategoryBreakdownRow[]
  loading: boolean
}) {
  const { t } = useTranslation('finance')
  const categoryLabel = useCategoryLabel()
  const mine = rows.filter((row) => row.kind === kind)

  return (
    <Panel
      title={t(kind === 'INCOME' ? 'finance:breakdown.titleIn' : 'finance:breakdown.titleOut')}
      description={t(
        kind === 'INCOME' ? 'finance:breakdown.descriptionIn' : 'finance:breakdown.descriptionOut',
      )}
    >
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : mine.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {t(kind === 'INCOME' ? 'finance:breakdown.emptyIn' : 'finance:breakdown.emptyOut')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {mine.map((row) => (
            <li key={row.categoryId} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-ink">{categoryLabel(row)}</span>
                <span className="shrink-0 text-sm">
                  <Money value={row.total} tone={kind === 'INCOME' ? 'in' : 'out'} />
                  <span className="ml-2 text-ink-muted">
                    {t('finance:breakdown.share', { share: row.share })}
                  </span>
                </span>
              </div>
              <div aria-hidden="true" className="h-1.5 w-full rounded-sm bg-surface-subtle">
                <div
                  className={`h-1.5 rounded-sm ${kind === 'INCOME' ? 'bg-success-fg' : 'bg-danger-fg'}`}
                  style={{ width: `${row.share}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** The last few entries of the period, as a way into the ledger rather than a report of its own. */
function RecentEntries({
  rows,
  loading,
  error,
  ledgerLink,
}: {
  rows: TransactionRow[]
  loading: boolean
  error: string | null
  ledgerLink: string
}) {
  const { t } = useTranslation(['finance', 'common'])
  const formatDate = useFormatDate()
  const categoryLabel = useCategoryLabel()

  const columns: Column<TransactionRow>[] = [
    {
      key: 'occurredAt',
      header: t('finance:columns.occurredAt'),
      render: (row) => formatDate(row.occurredAt),
    },
    {
      key: 'description',
      header: t('finance:columns.description'),
      render: (row) => (
        <div className="min-w-0">
          <span className="block truncate text-ink">{row.description}</span>
          <span className="block text-xs text-ink-muted">
            {categoryLabel({ name: row.categoryName, nameRw: row.categoryNameRw })}
          </span>
        </div>
      ),
    },
    {
      key: 'amount',
      header: t('finance:columns.amount'),
      align: 'right',
      render: (row) => (
        <Money
          value={row.amount}
          tone={row.status === 'VOID' ? 'neutral' : row.kind === 'INCOME' ? 'in' : 'out'}
        />
      ),
    },
    {
      key: 'status',
      header: t('finance:columns.status'),
      render: (row) => (
        <Badge tone={row.status === 'VOID' ? 'neutral' : 'success'}>
          {t(`finance:status.${row.status}`, { defaultValue: row.status })}
        </Badge>
      ),
    },
  ]

  return (
    <Panel
      flush
      title={t('finance:recent.title')}
      description={t('finance:recent.description')}
      actions={
        <Button variant="secondary" size="sm" asChild>
          <Link to={ledgerLink}>{t('finance:recent.seeAll')}</Link>
        </Button>
      }
    >
      {error ? (
        <div className="p-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t('finance:recent.caption')}
          loading={loading}
          rowMuted={(row) => row.status === 'VOID'}
          empty={
            <EmptyState
              icon={Coins}
              title={t('finance:recent.emptyTitle')}
              description={t('finance:recent.emptyBody')}
            />
          }
          mobileRow={(row) => (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-ink">{row.description}</span>
                <Money
                  value={row.amount}
                  tone={row.status === 'VOID' ? 'neutral' : row.kind === 'INCOME' ? 'in' : 'out'}
                />
              </div>
              <p className="text-sm text-ink-muted">
                {formatDate(row.occurredAt)} ·{' '}
                {categoryLabel({ name: row.categoryName, nameRw: row.categoryNameRw })}
              </p>
            </div>
          )}
        />
      )}
    </Panel>
  )
}
