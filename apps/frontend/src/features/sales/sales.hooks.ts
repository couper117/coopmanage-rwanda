import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
// `useDebouncedValue` is pure state and carries no finance meaning; it is imported rather than
// copied so a search field behaves the same way in every feature. The finance and inventory
// namespaces are invalidated alongside this one for the reason given on `useSalesMutation`.
import { financeKeys, useDebouncedValue } from '@/features/finance/finance.hooks'
import { inventoryKeys } from '@/features/inventory/inventory.hooks'
import { useApiError, type DisplayableError } from '@/hooks/useApiErrorMessage'
import { ApiError } from '@/lib/apiClient'
import { useAuthStore } from '@/stores/authStore'
import {
  BUYER_SORTS,
  cancelSale,
  confirmSale,
  createBuyer,
  createSale,
  DEFAULT_BUYER_SORT,
  DEFAULT_SALE_SORT,
  EMPTY_BUYER_FILTERS,
  EMPTY_SALE_FILTERS,
  fetchBuyer,
  fetchBuyerSummary,
  fetchReceipt,
  fetchSale,
  fetchSalesSummary,
  listBuyers,
  listSales,
  PAYMENT_STATUSES,
  recordSalePayment,
  SALE_SORTS,
  SALE_STATUSES,
  updateBuyer,
  updateSale,
  type BuyerFilters,
  type BuyerInput,
  type BuyerSort,
  type ConfirmSaleInput,
  type DateRange,
  type GroupBy,
  type PaymentStatus,
  type SaleFilters,
  type SaleInput,
  type SalePaymentInput,
  type SaleSort,
  type SaleStatus,
  type UpdateBuyerInput,
  type UpdateSaleInput,
} from './sales.api'

export { useDebouncedValue }

/**
 * Server state for the cooperative's buyers and sales.
 *
 * Every key is namespaced under `sales` and carries the cooperative it belongs to, so switching
 * tenant can never show the previous cooperative's sales from cache. Mutations invalidate the
 * whole namespace rather than patching a row: confirming one sale changes the sale, the list, the
 * period summary, the buyer's history, the stock levels and the books at once, and refetching is
 * both simpler and more truthful than reconciling six views by hand.
 */
export const salesKeys = {
  all: ['sales'] as const,
  scope: (cooperativeId: string | null) => ['sales', cooperativeId] as const,
  list: (cooperativeId: string | null, filters: SaleFilters) =>
    ['sales', cooperativeId, 'list', filters] as const,
  detail: (cooperativeId: string | null, id: string) =>
    ['sales', cooperativeId, 'detail', id] as const,
  receipt: (cooperativeId: string | null, id: string) =>
    ['sales', cooperativeId, 'receipt', id] as const,
  summary: (cooperativeId: string | null, range: DateRange, groupBy: GroupBy) =>
    ['sales', cooperativeId, 'summary', range, groupBy] as const,
  buyers: (cooperativeId: string | null, filters: BuyerFilters) =>
    ['sales', cooperativeId, 'buyers', filters] as const,
  buyer: (cooperativeId: string | null, id: string) =>
    ['sales', cooperativeId, 'buyer', id] as const,
  buyerSummary: (cooperativeId: string | null, id: string) =>
    ['sales', cooperativeId, 'buyerSummary', id] as const,
  buyerLookup: (cooperativeId: string | null, query: string) =>
    ['sales', cooperativeId, 'buyerLookup', query] as const,
}

function useCooperativeId(): string | null {
  return useAuthStore((state) => state.activeCooperativeId)
}

/**
 * Refusals that are particular to sales, mapped to sentences that say what to do about them.
 * The shared hook translates everything else.
 *
 * `notADraft`, `alreadyConfirmed` and `alreadyCancelled` are a backstop rather than the
 * explanation: the detail screen offers only the actions the sale's own state allows, so these
 * are what somebody sees when the sale moved on in another window while they were reading it.
 */
const SALES_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  'errors.sales.buyerNameTaken': 'apiErrors.buyerNameTaken',
  'errors.sales.buyerInactive': 'apiErrors.buyerInactive',
  'errors.sales.warehouseClosed': 'apiErrors.warehouseClosed',
  'errors.sales.productRetired': 'apiErrors.productRetired',
  'errors.sales.notADraft': 'apiErrors.notADraft',
  'errors.sales.alreadyConfirmed': 'apiErrors.alreadyConfirmed',
  'errors.sales.alreadyCancelled': 'apiErrors.alreadyCancelled',
  'errors.sales.cancelled': 'apiErrors.cancelled',
  'errors.sales.noLines': 'apiErrors.noLines',
  'errors.sales.paymentNeedsConfirmed': 'apiErrors.paymentNeedsConfirmed',
  'errors.inventory.insufficientStock': 'apiErrors.insufficientStock',
}

export function useSalesError(): (error: unknown) => DisplayableError {
  const describeError = useApiError()
  const { t } = useTranslation('sales')

  return useCallback(
    (error: unknown): DisplayableError => {
      const described = describeError(error)
      if (!(error instanceof ApiError)) return described
      const key = SALES_MESSAGE_KEYS[error.messageKey]
      if (!key) return described
      return { ...described, message: t(key, { ...error.messageParams }) }
    },
    [describeError, t],
  )
}

/**
 * The refusals the server reports against a particular field rather than against the request as a
 * whole. None of these has a sentence in the shared validation namespace, so they are translated
 * here; anything unrecognised is handed back as the key it arrived as, which `FormField` resolves
 * against the validation namespace on its own.
 */
const FIELD_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  'validation.discountTooLarge': 'fieldErrors.discountTooLarge',
  'validation.paymentExceedsTotal': 'fieldErrors.paymentExceedsTotal',
  'validation.paymentExceedsOutstanding': 'fieldErrors.paymentExceedsOutstanding',
}

export function useSalesFieldError(): (
  fieldErrors: Record<string, string>,
  field: string,
) => string | undefined {
  const { t } = useTranslation('sales')

  return useCallback(
    (fieldErrors: Record<string, string>, field: string): string | undefined => {
      const raw = fieldErrors[field]
      if (raw === undefined) return undefined
      const key = FIELD_MESSAGE_KEYS[raw]
      return key ? t(key) : raw
    },
    [t],
  )
}

/**
 * True for the one refusal a screen has to react to rather than merely report.
 *
 * The whole confirmation is a single transaction, so a store that cannot fill the sale leaves it
 * exactly as it was: still a draft, with nothing moved and no money recorded. That is what the
 * confirm dialog says, and it offers to read the sale again rather than quoting back a stock
 * figure the server deliberately did not send.
 */
export function isInsufficientStock(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'INSUFFICIENT_STOCK'
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Dates on the sales screens.
 *
 * A date-only value from the API is midnight UTC. Formatting it directly would show the previous
 * day to anybody west of Greenwich, so it is read at midday instead. Both languages use the
 * day-month-year order Rwandan offices write.
 */
function parseApiDate(value: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value)
}

function intlLocale(language: string | undefined): string {
  return language === 'rw' ? 'en-RW' : 'en-GB'
}

export function useFormatDate(): (value: string) => string {
  const { i18n } = useTranslation('sales')
  const locale = intlLocale(i18n.resolvedLanguage)
  return useCallback(
    (value: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parseApiDate(value)),
    [locale],
  )
}

/** A moment rather than a day, for a confirmation time and for when a receipt was issued. */
export function useFormatDateTime(): (value: string) => string {
  const { i18n } = useTranslation('sales')
  const locale = intlLocale(i18n.resolvedLanguage)
  return useCallback(
    (value: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      ),
    [locale],
  )
}

/** A bucket label: the month for a monthly grouping, the day itself for the finer ones. */
export function useFormatBucket(): (value: string, groupBy: GroupBy) => string {
  const { i18n } = useTranslation('sales')
  const locale = intlLocale(i18n.resolvedLanguage)
  return useCallback(
    (value: string, groupBy: GroupBy) =>
      new Intl.DateTimeFormat(
        locale,
        groupBy === 'month'
          ? { month: 'short', year: 'numeric' }
          : { day: 'numeric', month: 'short' },
      ).format(parseApiDate(value)),
    [locale],
  )
}

export function useFormatNumber(): (value: number) => string {
  const { i18n } = useTranslation('sales')
  const locale = intlLocale(i18n.resolvedLanguage)
  return useCallback((value: number) => new Intl.NumberFormat(locale).format(value), [locale])
}

/** Today, as the server writes dates, for a form default. */
export function todayIso(): string {
  return isoDate(new Date())
}

function isoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * The period the summary covers when the list itself has not been narrowed to one.
 *
 * Built from calendar parts rather than by subtracting milliseconds, so a month is a month
 * whatever its length and the boundary does not drift.
 */
export function thisMonthRange(today = new Date()): DateRange {
  const start = new Date(today.getFullYear(), today.getMonth(), 1)
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  return { from: isoDate(start), to: isoDate(end) }
}

/**
 * Which period the summary panel reports on.
 *
 * A reader who has narrowed the list to a range is asking about that range, so the summary
 * follows it; otherwise the current month is the question a manager is usually answering. Either
 * way the panel says out loud which dates it covers, so the figure is never read against the
 * wrong period.
 */
export function summaryRangeFor(filters: SaleFilters, today = new Date()): DateRange {
  if (filters.from !== '' && filters.to !== '') return { from: filters.from, to: filters.to }
  const fallback = thisMonthRange(today)
  return {
    from: filters.from !== '' ? filters.from : fallback.from,
    to: filters.to !== '' ? filters.to : fallback.to,
  }
}

/**
 * The grouping a range reads best at.
 *
 * A month shown by month is one bar and tells nobody anything; a year shown by day is three
 * hundred and sixty-five bars nobody can read. These thresholds keep the chart between roughly
 * ten and forty bars, which is what fits on an office screen.
 */
export function autoGroupBy(range: DateRange): GroupBy {
  const days = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000
  if (!Number.isFinite(days) || days <= 45) return 'day'
  if (days <= 200) return 'week'
  return 'month'
}

// ---------------------------------------------------------------------------
// Filters in the URL
// ---------------------------------------------------------------------------

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function oneOf<TValue extends string>(
  allowed: readonly TValue[],
  value: string | null,
): TValue | '' {
  return allowed.find((candidate) => candidate === value) ?? ''
}

function readPage(value: string | null): number {
  const page = Number(value)
  return Number.isInteger(page) && page >= 1 ? page : 1
}

function readDate(value: string | null): string {
  return value !== null && DATE_ONLY.test(value) ? value : ''
}

function readFlag(value: string | null): boolean {
  return value === 'true'
}

export function readSaleFiltersFromParams(params: URLSearchParams): SaleFilters {
  return {
    q: params.get('q') ?? '',
    buyerId: params.get('buyerId') ?? '',
    warehouseId: params.get('warehouseId') ?? '',
    status: oneOf<SaleStatus>(SALE_STATUSES, params.get('status')),
    paymentStatus: oneOf<PaymentStatus>(PAYMENT_STATUSES, params.get('paymentStatus')),
    from: readDate(params.get('from')),
    to: readDate(params.get('to')),
    sort: oneOf<SaleSort>(SALE_SORTS, params.get('sort')) || DEFAULT_SALE_SORT,
    page: readPage(params.get('page')),
    pageSize: EMPTY_SALE_FILTERS.pageSize,
  }
}

/** Only what differs from the default is written, so a shared link stays readable. */
function writeSaleFiltersToParams(filters: SaleFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.buyerId) params.set('buyerId', filters.buyerId)
  if (filters.warehouseId) params.set('warehouseId', filters.warehouseId)
  if (filters.status) params.set('status', filters.status)
  if (filters.paymentStatus) params.set('paymentStatus', filters.paymentStatus)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.sort !== DEFAULT_SALE_SORT) params.set('sort', filters.sort)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

export function readBuyerFiltersFromParams(params: URLSearchParams): BuyerFilters {
  return {
    q: params.get('q') ?? '',
    includeInactive: readFlag(params.get('includeInactive')),
    sort: oneOf<BuyerSort>(BUYER_SORTS, params.get('sort')) || DEFAULT_BUYER_SORT,
    page: readPage(params.get('page')),
    pageSize: EMPTY_BUYER_FILTERS.pageSize,
  }
}

function writeBuyerFiltersToParams(filters: BuyerFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.includeInactive) params.set('includeInactive', 'true')
  if (filters.sort !== DEFAULT_BUYER_SORT) params.set('sort', filters.sort)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

export interface FilterState<TFilters> {
  filters: TFilters
  /** Merges changes and returns to page one, unless the change is itself a page. */
  patch: (changes: Partial<TFilters>) => void
  clear: () => void
}

/**
 * Builds one of the two filter hooks below.
 *
 * The filters live in the URL rather than in component state, so a view narrowed to one buyer and
 * one month can be bookmarked, sent to the manager, and reached again by the back button. The two
 * sets differ only in what they read and write, so the paging and history behaviour is defined
 * once here: any change to a filter returns to the first page, because staying on page four of a
 * narrower result is how a reader ends up looking at an empty table and concluding there is
 * nothing there.
 */
function makeFilterHook<TFilters extends { page: number }>(
  read: (params: URLSearchParams) => TFilters,
  write: (filters: TFilters) => URLSearchParams,
): () => FilterState<TFilters> {
  return function useFilters(): FilterState<TFilters> {
    const [params, setParams] = useSearchParams()

    const patch = useCallback(
      (changes: Partial<TFilters>) => {
        setParams(
          (current) => {
            const merged = { ...read(current), ...changes }
            if (changes.page === undefined) merged.page = 1
            return write(merged)
          },
          // Turning a page is a place you can go back to; retyping a filter is not.
          { replace: changes.page === undefined },
        )
      },
      // `read` and `write` come from the factory's closure rather than from a render, so they are
      // outer-scope values and not reactive dependencies.
      [setParams],
    )

    const clear = useCallback(() => {
      setParams(new URLSearchParams(), { replace: true })
    }, [setParams])

    return { filters: read(params), patch, clear }
  }
}

export const useSaleFilters = makeFilterHook(readSaleFiltersFromParams, writeSaleFiltersToParams)

export const useBuyerFilters = makeFilterHook(readBuyerFiltersFromParams, writeBuyerFiltersToParams)

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function useSalesList(filters: SaleFilters) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: salesKeys.list(cooperativeId, filters),
    queryFn: () => listSales(filters),
    enabled: cooperativeId !== null,
  })
}

export function useSale(id: string | undefined) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: salesKeys.detail(cooperativeId, id ?? ''),
    queryFn: () => fetchSale(id ?? ''),
    enabled: id !== undefined && id !== '' && cooperativeId !== null,
  })
}

/**
 * The receipt. Asked for only when somebody opens one, because the server writes an audit entry
 * every time it is read and a sale being looked at is not a receipt being issued.
 */
export function useSaleReceipt(id: string | undefined) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: salesKeys.receipt(cooperativeId, id ?? ''),
    queryFn: () => fetchReceipt(id ?? ''),
    enabled: id !== undefined && id !== '' && cooperativeId !== null,
  })
}

export function useSalesSummary(range: DateRange, groupBy: GroupBy) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: salesKeys.summary(cooperativeId, range, groupBy),
    queryFn: () => fetchSalesSummary(range, groupBy),
    enabled: cooperativeId !== null,
  })
}

export function useBuyersList(filters: BuyerFilters) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: salesKeys.buyers(cooperativeId, filters),
    queryFn: () => listBuyers(filters),
    enabled: cooperativeId !== null,
  })
}

export function useBuyer(id: string | undefined) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: salesKeys.buyer(cooperativeId, id ?? ''),
    queryFn: () => fetchBuyer(id ?? ''),
    enabled: id !== undefined && id !== '' && cooperativeId !== null,
  })
}

/**
 * A buyer's history. `enabled` carries the caller's own condition, which is whether the reader
 * holds `sales:view` as well: the endpoint needs both permissions, and asking without them would
 * only put a refusal on a screen the reader is otherwise entitled to.
 */
export function useBuyerSummary(id: string | undefined, enabled: boolean) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: salesKeys.buyerSummary(cooperativeId, id ?? ''),
    queryFn: () => fetchBuyerSummary(id ?? ''),
    enabled: enabled && id !== undefined && id !== '' && cooperativeId !== null,
  })
}

/**
 * The picker over the buyers, which is too long for a dropdown once a cooperative has been
 * trading a season. Inactive buyers are left out: a sale cannot name one, so offering one would
 * only produce a refusal.
 */
export function useBuyerLookup(query: string, enabled: boolean) {
  const cooperativeId = useCooperativeId()
  const debounced = useDebouncedValue(query.trim(), 250)

  return useQuery({
    queryKey: salesKeys.buyerLookup(cooperativeId, debounced),
    queryFn: () => listBuyers({ ...EMPTY_BUYER_FILTERS, q: debounced, pageSize: 10 }),
    enabled: enabled && cooperativeId !== null,
    // The previous ten stay on screen while the next ten are fetched, so the list does not blink
    // empty between keystrokes and offer "nothing found" to somebody mid-word.
    placeholderData: keepPreviousData,
  })
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * One invalidation for the whole feature, for the reason given on `salesKeys`.
 *
 * The store and the books are invalidated alongside it, because confirming a sale takes stock out
 * and posts an income entry in the same transaction, and cancelling one puts the stock back and
 * reverses the entry. Leaving either alone would let a storekeeper sit in front of a level that no
 * longer exists, or a treasurer in front of a balance missing money just taken at the counter.
 */
function useSalesMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const cooperativeId = useCooperativeId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: salesKeys.scope(cooperativeId) })
      await queryClient.invalidateQueries({ queryKey: inventoryKeys.scope(cooperativeId) })
      await queryClient.invalidateQueries({ queryKey: financeKeys.scope(cooperativeId) })
    },
  })
}

export function useCreateBuyer() {
  return useSalesMutation((input: BuyerInput) => createBuyer(input))
}

export function useUpdateBuyer() {
  return useSalesMutation((input: { id: string; changes: UpdateBuyerInput }) =>
    updateBuyer(input.id, input.changes),
  )
}

export function useCreateSale() {
  return useSalesMutation((input: SaleInput) => createSale(input))
}

export function useUpdateSale() {
  return useSalesMutation((input: { id: string; changes: UpdateSaleInput }) =>
    updateSale(input.id, input.changes),
  )
}

export function useConfirmSale() {
  return useSalesMutation((input: { id: string; body: ConfirmSaleInput }) =>
    confirmSale(input.id, input.body),
  )
}

export function useCancelSale() {
  return useSalesMutation((input: { id: string; reason: string }) =>
    cancelSale(input.id, input.reason),
  )
}

export function useRecordSalePayment() {
  return useSalesMutation((input: { id: string; body: SalePaymentInput }) =>
    recordSalePayment(input.id, input.body),
  )
}
