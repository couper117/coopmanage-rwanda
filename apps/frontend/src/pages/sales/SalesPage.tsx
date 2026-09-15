import { ArrowRight, Receipt, SearchX, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
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
  Quantity,
  SearchSelect,
  Select,
  Skeleton,
  type BadgeTone,
  type Column,
  type SearchOption,
  type SelectOption,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { useWarehouses } from '@/features/inventory/inventory.hooks'
import {
  barPercent,
  countActiveSaleFilters,
  largestMoney,
  PAYMENT_STATUSES,
  SALE_SORTS,
  SALE_STATUSES,
  type GroupBy,
  type PaymentStatus,
  type SaleRow,
  type SaleSort,
  type SaleStatus,
  type SalesSummary,
} from '@/features/sales/sales.api'
import {
  autoGroupBy,
  summaryRangeFor,
  useBuyerLookup,
  useDebouncedValue,
  useFormatBucket,
  useFormatDate,
  useFormatNumber,
  useSaleFilters,
  useSalesError,
  useSalesList,
  useSalesSummary,
} from '@/features/sales/sales.hooks'

/**
 * What the cooperative has sold.
 *
 * The screen answers two questions in that order. First, what the period comes to — sold, paid,
 * still owed, and who and what it was — because that is the question a manager is asked at a
 * meeting. Then the sales themselves, narrowed by whatever the reader is looking for.
 *
 * **The footer totals are confirmed sales only, and say so.** A draft is an intention somebody
 * typed, not business the cooperative did, so counting one would overstate the figure a manager
 * reads out. The same is true of the summary panel above, which the server computes the same way.
 * Both cover the whole filter rather than the page on screen.
 *
 * **The chart is drawn by hand, in CSS.** No charting library is installed and the content
 * security policy would not load one from a CDN, which is a constraint rather than a compromise:
 * bars are the only form this data needs, and the exact figures sit in a table beside them,
 * because a bar can only ever be read approximately and an amount in a cooperative's books is not
 * an approximate thing.
 *
 * **Every figure on this screen is the string the server sent.** `Money` and `Quantity` render
 * them from their characters. The only arithmetic is over row counts and the integer bar ratios,
 * neither of which is ever shown as an amount.
 *
 * The filters live in the URL, so a view narrowed to one buyer and one month can be bookmarked and
 * sent to the manager. Every control is hidden when the permission behind it is absent, which is a
 * courtesy to the reader and not the security boundary: the server checks again on every request.
 */

const STATUS_TONE: Readonly<Record<SaleStatus, BadgeTone>> = {
  DRAFT: 'neutral',
  CONFIRMED: 'success',
  CANCELLED: 'danger',
}

const PAYMENT_TONE: Readonly<Record<PaymentStatus, BadgeTone>> = {
  UNPAID: 'warning',
  PARTIAL: 'info',
  PAID: 'success',
}

export function SalesPage() {
  const { t } = useTranslation(['sales', 'common'])
  const describeError = useSalesError()
  const formatDate = useFormatDate()
  const formatNumber = useFormatNumber()
  const navigate = useNavigate()

  const canCreate = usePermission('sales:create')
  const canSeeBuyers = usePermission('buyers:view')

  const { filters, patch, clear } = useSaleFilters()
  const sales = useSalesList(filters)
  const warehouses = useWarehouses()

  const range = summaryRangeFor(filters)
  const groupBy = autoGroupBy(range)
  const summary = useSalesSummary(range, groupBy)

  const [showFilters, setShowFilters] = useState(() => countActiveSaleFilters(filters) > 0)

  // The search field keeps its own value so typing stays instant; the URL is rewritten only once
  // typing has stopped, which is also what stops one request going out per keystroke.
  const [search, setSearch] = useState(filters.q)
  const debouncedSearch = useDebouncedValue(search, 300)

  useEffect(() => {
    if (debouncedSearch.trim() === filters.q) return
    patch({ q: debouncedSearch.trim() })
  }, [debouncedSearch, filters.q, patch])

  /** The buyer filter, which is a picker over a list too long for a dropdown. */
  const [buyer, setBuyer] = useState<SearchOption | null>(null)
  const [buyerQuery, setBuyerQuery] = useState('')
  const buyerLookup = useBuyerLookup(buyerQuery, canSeeBuyers && buyer === null)

  const rows = sales.data?.items ?? []
  const meta = sales.data?.meta
  const totals = sales.data?.totals
  const activeFilters = countActiveSaleFilters(filters)
  const filtersApplied = activeFilters > 0

  function clearEverything(): void {
    setSearch('')
    setBuyer(null)
    setBuyerQuery('')
    clear()
  }

  const warehouseOptions: SelectOption[] = [
    { value: '', label: t('sales:filters.anyWarehouse') },
    ...(warehouses.data ?? []).map((store) => ({ value: store.id, label: store.name })),
  ]
  const statusOptions: SelectOption[] = [
    { value: '', label: t('sales:filters.anyStatus') },
    ...SALE_STATUSES.map((value) => ({ value, label: t(`sales:status.${value}`) })),
  ]
  const paymentOptions: SelectOption[] = [
    { value: '', label: t('sales:filters.anyPaymentStatus') },
    ...PAYMENT_STATUSES.map((value) => ({ value, label: t(`sales:paymentStatus.${value}`) })),
  ]
  const sortOptions: SelectOption[] = SALE_SORTS.map((value) => ({
    value,
    label: t(`sales:saleSort.${value}`),
  }))
  const buyerOptions: SearchOption[] = (buyerLookup.data?.items ?? []).map((row) => ({
    value: row.id,
    label: row.name,
    hint: row.organization ?? row.phone ?? undefined,
  }))

  const columns: Column<SaleRow>[] = [
    {
      key: 'reference',
      header: t('sales:saleColumns.reference'),
      // The reference is itself the link, so the sale is reachable with a keyboard and shows in
      // the browser's status bar, as well as by clicking anywhere in the row.
      render: (row) => (
        <div className="min-w-0">
          <Link
            to={`/sales/${row.id}`}
            onClick={(event) => event.stopPropagation()}
            className="block font-medium text-primary-600 hover:underline"
          >
            {row.reference}
          </Link>
          <span className="block text-xs text-ink-muted">{formatDate(row.saleDate)}</span>
        </div>
      ),
    },
    {
      key: 'buyer',
      header: t('sales:saleColumns.buyer'),
      render: (row) => row.buyerName,
    },
    {
      key: 'warehouse',
      header: t('sales:saleColumns.warehouse'),
      secondary: true,
      render: (row) => row.warehouseName,
    },
    {
      key: 'lines',
      header: t('sales:saleColumns.lines'),
      align: 'right',
      secondary: true,
      render: (row) =>
        row.lineCount === 1
          ? t('sales:list.oneLine')
          : t('sales:list.lineCount', { total: formatNumber(row.lineCount) }),
    },
    {
      key: 'total',
      header: t('sales:saleColumns.total'),
      align: 'right',
      render: (row) => <Money value={row.total} />,
    },
    {
      key: 'outstanding',
      header: t('sales:saleColumns.outstanding'),
      align: 'right',
      render: (row) => <Money value={row.outstanding} />,
    },
    {
      key: 'status',
      header: t('sales:saleColumns.status'),
      width: '9rem',
      // The state is a word and a dot, never a colour alone, so a draft reads as a draft on a
      // monochrome printout and to somebody who cannot tell green from red.
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status]}>{t(`sales:status.${row.status}`)}</Badge>
      ),
    },
    {
      key: 'payment',
      header: t('sales:saleColumns.payment'),
      width: '9rem',
      render: (row) => (
        <Badge tone={PAYMENT_TONE[row.paymentStatus]}>
          {t(`sales:paymentStatus.${row.paymentStatus}`)}
        </Badge>
      ),
    },
  ]

  const from = meta ? (meta.page - 1) * meta.pageSize + 1 : 0
  const to = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('sales:list.title')}
        description={t('sales:list.description')}
        actions={
          <>
            {canSeeBuyers ? (
              <Button variant="secondary" asChild>
                <Link to="/buyers">
                  {t('sales:list.toBuyers')}
                  <ArrowRight aria-hidden="true" className="ml-2 size-4" />
                </Link>
              </Button>
            ) : null}
            {canCreate ? (
              <Button asChild>
                <Link to="/sales/new">{t('sales:list.recordSale')}</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <SummaryPanel
        summary={summary.data}
        loading={summary.isPending}
        error={summary.isError ? describeError(summary.error).message : null}
        groupBy={groupBy}
        from={formatDate(range.from)}
        to={formatDate(range.to)}
      />

      <Panel flush>
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <FormField label={t('sales:search.label')} className="min-w-56 flex-1">
              <Input
                type="search"
                placeholder={t('sales:search.placeholder')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </FormField>

            <FormField label={t('sales:filters.status')} className="w-48">
              <Select
                options={statusOptions}
                value={filters.status}
                onChange={(event) => patch({ status: readStatus(event.target.value) })}
              />
            </FormField>

            <FormField label={t('sales:filters.paymentStatus')} className="w-48">
              <Select
                options={paymentOptions}
                value={filters.paymentStatus}
                onChange={(event) =>
                  patch({ paymentStatus: readPaymentStatus(event.target.value) })
                }
              />
            </FormField>

            <FormField label={t('sales:saleSort.label')} className="w-56">
              <Select
                options={sortOptions}
                value={filters.sort}
                onChange={(event) => patch({ sort: readSort(event.target.value) })}
              />
            </FormField>

            <Button
              variant="secondary"
              aria-expanded={showFilters}
              aria-controls="sales-more-filters"
              leadingIcon={<SlidersHorizontal aria-hidden="true" className="size-4" />}
              onClick={() => setShowFilters((open) => !open)}
            >
              {activeFilters > 0
                ? t('sales:filters.showWithCount', { total: activeFilters })
                : t('sales:filters.show')}
            </Button>

            {filtersApplied ? (
              <Button
                variant="ghost"
                leadingIcon={<X aria-hidden="true" className="size-4" />}
                onClick={clearEverything}
              >
                {t('common:actions.clearFilters')}
              </Button>
            ) : null}
          </div>

          <div
            id="sales-more-filters"
            hidden={!showFilters}
            className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            {canSeeBuyers ? (
              <FormField label={t('sales:filters.buyer')}>
                <SearchSelect
                  value={buyer}
                  onChange={(option) => {
                    setBuyer(option)
                    patch({ buyerId: option?.value ?? '' })
                  }}
                  options={buyerOptions}
                  query={buyerQuery}
                  onQueryChange={setBuyerQuery}
                  loading={buyerLookup.isFetching}
                  placeholder={t('sales:filters.buyerPlaceholder')}
                  emptyLabel={t('sales:filters.buyerEmpty')}
                  loadingLabel={t('sales:filters.buyerLoading')}
                  clearLabel={t('sales:filters.buyerClear')}
                />
              </FormField>
            ) : null}

            <FormField label={t('sales:filters.warehouse')}>
              <Select
                options={warehouseOptions}
                value={filters.warehouseId}
                onChange={(event) => patch({ warehouseId: event.target.value })}
              />
            </FormField>

            <FormField label={t('sales:filters.from')}>
              <Input
                type="date"
                value={filters.from}
                onChange={(event) => patch({ from: event.target.value })}
              />
            </FormField>

            <FormField label={t('sales:filters.to')}>
              <Input
                type="date"
                value={filters.to}
                onChange={(event) => patch({ to: event.target.value })}
              />
            </FormField>
          </div>
        </div>

        {sales.isError ? (
          <div className="p-4">
            <Alert
              tone="danger"
              title={t('sales:list.loadFailed')}
              action={
                <Button variant="secondary" size="sm" onClick={() => void sales.refetch()}>
                  {t('common:actions.retry')}
                </Button>
              }
            >
              {describeError(sales.error).message}
            </Alert>
          </div>
        ) : (
          <>
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(row) => row.id}
              caption={t('sales:list.caption')}
              loading={sales.isPending}
              // A cancelled sale is still part of the history and still reads, but it is not
              // business the cooperative is doing, so the row is quietened.
              rowMuted={(row) => row.status === 'CANCELLED'}
              footer={
                totals ? (
                  /* One cell across the table: the three figures belong together as a sentence
                     about the filter, not as three numbers under three unrelated columns. */
                  <td colSpan={columns.length} className="px-3 py-2 text-sm">
                    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span>
                        {t('sales:list.totalSold')} <Money value={totals.sold} />
                      </span>
                      <span>
                        {t('sales:list.totalPaid')} <Money value={totals.paid} />
                      </span>
                      <span>
                        {t('sales:list.totalOutstanding')} <Money value={totals.outstanding} />
                      </span>
                      <span className="text-ink-muted">{t('sales:list.totalsCover')}</span>
                    </span>
                  </td>
                ) : undefined
              }
              empty={
                filtersApplied ? (
                  <EmptyState
                    icon={SearchX}
                    title={t('sales:list.emptyFilteredTitle')}
                    description={t('sales:list.emptyFilteredBody')}
                    action={
                      <Button variant="secondary" onClick={clearEverything}>
                        {t('common:actions.clearFilters')}
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon={Receipt}
                    title={t('sales:list.emptyTitle')}
                    description={t('sales:list.emptyBody')}
                    action={
                      canCreate ? (
                        <Button asChild>
                          <Link to="/sales/new">{t('sales:list.recordSale')}</Link>
                        </Button>
                      ) : undefined
                    }
                  />
                )
              }
              mobileRow={(row) => (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Link to={`/sales/${row.id}`} className="font-medium text-primary-600">
                      {row.reference}
                    </Link>
                    <Money value={row.total} />
                  </div>
                  <p className="text-sm text-ink-muted">
                    {row.buyerName} · {formatDate(row.saleDate)}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={STATUS_TONE[row.status]}>{t(`sales:status.${row.status}`)}</Badge>
                    <Badge tone={PAYMENT_TONE[row.paymentStatus]}>
                      {t(`sales:paymentStatus.${row.paymentStatus}`)}
                    </Badge>
                  </div>
                </div>
              )}
              // The whole row opens the sale, because that is where every action on it lives.
              onRowClick={(row) => void navigate(`/sales/${row.id}`)}
            />

            {meta && meta.total > 0 && !sales.isPending ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
                <p className="text-sm text-ink-muted">
                  {t('sales:pagination.sales', {
                    from: formatNumber(from),
                    to: formatNumber(to),
                    total: formatNumber(meta.total),
                  })}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={meta.page <= 1}
                    onClick={() => patch({ page: Math.max(1, meta.page - 1) })}
                  >
                    {t('common:actions.previous')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={meta.page >= meta.totalPages}
                    onClick={() => patch({ page: meta.page + 1 })}
                  >
                    {t('common:actions.next')}
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Panel>
    </div>
  )
}

/**
 * What the period comes to, and who and what it was.
 *
 * Confirmed sales only, because that is how the server computes it, and the panel says so in its
 * own description rather than leaving the reader to assume. The bars carry no figures of their
 * own: the table beside them holds the exact amounts, and the bars are there to show shape.
 */
function SummaryPanel({
  summary,
  loading,
  error,
  groupBy,
  from,
  to,
}: {
  summary: SalesSummary | undefined
  loading: boolean
  error: string | null
  groupBy: GroupBy
  from: string
  to: string
}) {
  const { t } = useTranslation(['sales', 'common'])
  const formatBucket = useFormatBucket()
  const formatNumber = useFormatNumber()

  const buckets = summary?.buckets ?? []
  const largest = largestMoney(buckets.map((bucket) => bucket.sold))

  return (
    <Panel
      title={t('sales:summary.title')}
      description={t('sales:summary.description', { from, to })}
    >
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : loading || summary === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="flex flex-col gap-5">
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-ink-muted">{t('sales:summary.sold')}</dt>
              <dd className="text-2xl font-semibold text-ink">
                <Money value={summary.sold} />
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-muted">{t('sales:summary.paid')}</dt>
              <dd className="text-2xl font-semibold text-ink">
                <Money value={summary.paid} />
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-muted">{t('sales:summary.outstanding')}</dt>
              <dd className="text-2xl font-semibold text-ink">
                <Money value={summary.outstanding} />
              </dd>
            </div>
          </dl>

          <p className="text-sm text-ink-secondary">
            {summary.saleCount === 1
              ? t('sales:summary.oneSale')
              : t('sales:summary.saleCount', { total: formatNumber(summary.saleCount) })}
          </p>

          {buckets.length === 0 || largest === 0n ? (
            <p className="text-sm text-ink-muted">{t('sales:summary.chartEmpty')}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <div className="flex h-40 min-w-full items-end gap-2">
                  {buckets.map((bucket) => (
                    <div
                      key={bucket.start}
                      role="img"
                      // Not `count`: i18next reserves that name for pluralisation and requires a
                      // number, and the figure here is already formatted for the reader.
                      aria-label={t('sales:summary.bucketLabel', {
                        period: formatBucket(bucket.start, groupBy),
                        sold: formatMoney(bucket.sold),
                        sales: formatNumber(bucket.saleCount),
                      })}
                      className="flex min-w-10 flex-1 flex-col items-center gap-1.5"
                    >
                      <div aria-hidden="true" className="flex h-32 w-full items-end justify-center">
                        <Bar percent={barPercent(bucket.sold, largest)} />
                      </div>
                      <span className="text-xs whitespace-nowrap text-ink-muted">
                        {formatBucket(bucket.start, groupBy)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/*
                The same figures, exactly. A bar can only ever be read approximately, and an
                amount in a cooperative's books is not an approximate thing, so the table is part
                of the answer rather than a fallback for it.
              */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="pb-2 text-left text-sm text-ink-secondary">
                    {t('sales:summary.tableCaption')}
                  </caption>
                  <thead>
                    <tr className="border-b border-line">
                      <th
                        scope="col"
                        className="px-2 py-1.5 text-left font-medium text-ink-secondary"
                      >
                        {t('sales:summary.columns.period')}
                      </th>
                      <th
                        scope="col"
                        className="px-2 py-1.5 text-right font-medium text-ink-secondary"
                      >
                        {t('sales:summary.columns.sold')}
                      </th>
                      <th
                        scope="col"
                        className="px-2 py-1.5 text-right font-medium text-ink-secondary"
                      >
                        {t('sales:summary.columns.count')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {buckets.map((bucket) => (
                      <tr key={bucket.start} className="border-b border-line last:border-0">
                        <td className="px-2 py-1.5">{formatBucket(bucket.start, groupBy)}</td>
                        <td className="px-2 py-1.5 text-right">
                          <Money value={bucket.sold} withCurrency={false} />
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {formatNumber(bucket.saleCount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <h3 className="text-base font-semibold text-ink">{t('sales:summary.topBuyers')}</h3>
              {summary.topBuyers.length === 0 ? (
                <p className="mt-1 text-sm text-ink-muted">{t('sales:summary.topBuyersEmpty')}</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {summary.topBuyers.map((row) => (
                    <li key={row.buyerId} className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <Link
                          to={`/buyers/${row.buyerId}`}
                          className="truncate text-base text-primary-600 hover:underline"
                        >
                          {row.name}
                        </Link>
                        <Money value={row.sold} withCurrency={false} />
                      </div>
                      <ShareBar
                        percent={barPercent(
                          row.sold,
                          largestMoney(summary.topBuyers.map((buyer) => buyer.sold)),
                        )}
                      />
                      <span className="text-xs text-ink-muted">
                        {row.saleCount === 1
                          ? t('sales:summary.oneBuyerSale')
                          : t('sales:summary.buyerSaleCount', {
                              total: formatNumber(row.saleCount),
                            })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="text-base font-semibold text-ink">{t('sales:summary.topProducts')}</h3>
              {summary.topProducts.length === 0 ? (
                <p className="mt-1 text-sm text-ink-muted">{t('sales:summary.topProductsEmpty')}</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {summary.topProducts.map((row) => (
                    <li key={row.productId} className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-base text-ink">{row.name}</span>
                        <Money value={row.sold} withCurrency={false} />
                      </div>
                      <ShareBar
                        percent={barPercent(
                          row.sold,
                          largestMoney(summary.topProducts.map((product) => product.sold)),
                        )}
                      />
                      <span className="text-xs text-ink-muted">
                        {row.sku} · <Quantity value={row.quantity} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </Panel>
  )
}

/** A vertical bar whose height is a percentage of the largest amount in the set. */
function Bar({ percent }: { percent: number }) {
  return (
    <span
      className={`w-5 rounded-t-sm ${percent === 0 ? 'bg-line-strong' : 'bg-primary-600'}`}
      style={{ height: percent === 0 ? '2px' : `${percent}%` }}
    />
  )
}

/** A horizontal share bar, for a ranked list where the label carries the exact figure already. */
function ShareBar({ percent }: { percent: number }) {
  return (
    <span aria-hidden="true" className="block h-1.5 w-full rounded-sm bg-surface-subtle">
      <span
        className="block h-full rounded-sm bg-primary-600"
        style={{ width: `${percent === 0 ? 1 : percent}%` }}
      />
    </span>
  )
}

/**
 * The selects hand back plain strings. Narrowing each against what the server accepts means a
 * hand-edited value in the address bar travels no further than here.
 */
function readSort(value: string): SaleSort {
  return SALE_SORTS.find((candidate) => candidate === value) ?? '-saleDate'
}

function readStatus(value: string): SaleStatus | '' {
  return SALE_STATUSES.find((candidate) => candidate === value) ?? ''
}

function readPaymentStatus(value: string): PaymentStatus | '' {
  return PAYMENT_STATUSES.find((candidate) => candidate === value) ?? ''
}
