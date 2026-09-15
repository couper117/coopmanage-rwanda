import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useApiError, type DisplayableError } from '@/hooks/useApiErrorMessage'
import { ApiError } from '@/lib/apiClient'
import { saveFile } from '@/lib/saveFile'
import { useAuthStore } from '@/stores/authStore'
import {
  createCategory,
  createTransaction,
  DEFAULT_FINANCE_SORT,
  EMPTY_LEDGER_FILTERS,
  fetchFinanceExport,
  fetchSummary,
  fetchTrends,
  FINANCE_KINDS,
  FINANCE_SORTS,
  FINANCE_STATUSES,
  GROUP_BYS,
  listCategories,
  listTransactions,
  newIdempotencyKey,
  PAYMENT_METHODS,
  updateCategory,
  updateTransaction,
  voidTransaction,
  type CategoryInput,
  type DateRange,
  type ExportFormat,
  type FinanceKind,
  type FinanceSort,
  type FinanceStatus,
  type GroupBy,
  type LedgerFilters,
  type PaymentMethod,
  type TransactionInput,
  type UpdateCategoryInput,
  type UpdateTransactionInput,
} from './finance.api'

/**
 * Server state for the cooperative's books.
 *
 * Every key is namespaced under `finance` and carries the cooperative it belongs to, so switching
 * tenant can never show the previous cooperative's balance from cache. Mutations invalidate the
 * whole namespace rather than patching a row: recording one entry changes the headline balance,
 * the trend, the category breakdown, the ledger page and the category's own entry count at once,
 * and refetching is both simpler and more truthful than reconciling five views by hand.
 */
export const financeKeys = {
  all: ['finance'] as const,
  scope: (cooperativeId: string | null) => ['finance', cooperativeId] as const,
  ledger: (cooperativeId: string | null, filters: LedgerFilters) =>
    ['finance', cooperativeId, 'ledger', filters] as const,
  summary: (cooperativeId: string | null, range: DateRange, groupBy: GroupBy) =>
    ['finance', cooperativeId, 'summary', range, groupBy] as const,
  trends: (cooperativeId: string | null, range: DateRange, groupBy: GroupBy) =>
    ['finance', cooperativeId, 'trends', range, groupBy] as const,
  categories: (cooperativeId: string | null, kind: FinanceKind | '', includeInactive: boolean) =>
    ['finance', cooperativeId, 'categories', kind, includeInactive] as const,
}

function useCooperativeId(): string | null {
  return useAuthStore((state) => state.activeCooperativeId)
}

/**
 * Holds a value still until typing stops, so the search field does not send one request per
 * keystroke over a ledger that can hold years of entries.
 */
export function useDebouncedValue<TValue>(value: TValue, delay = 300): TValue {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])

  return settled
}

/**
 * Refusals that are particular to the books, mapped to sentences that say what to do about them.
 * The shared hook translates everything else.
 *
 * `voidFromSource` is the one that matters most: it is the server telling the reader that the
 * entry belongs to a member's record and has to be cancelled there. The ledger also hides its
 * void control for such an entry, so this message is the backstop rather than the explanation.
 */
const FINANCE_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  'errors.finance.alreadyVoid': 'apiErrors.alreadyVoid',
  'errors.finance.voidFromSource': 'apiErrors.voidFromSource',
  'errors.finance.voidedNotEditable': 'apiErrors.voidedNotEditable',
  'errors.finance.categoryNameTaken': 'apiErrors.categoryNameTaken',
}

export function useFinanceError(): (error: unknown) => DisplayableError {
  const describeError = useApiError()
  const { t } = useTranslation('finance')

  return useCallback(
    (error: unknown): DisplayableError => {
      const described = describeError(error)
      if (!(error instanceof ApiError)) return described
      const key = FINANCE_MESSAGE_KEYS[error.messageKey]
      if (!key) return described
      return { ...described, message: t(key, { ...error.messageParams }) }
    },
    [describeError, t],
  )
}

/**
 * Dates on the finance screens.
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
  const { i18n } = useTranslation('finance')
  const locale = intlLocale(i18n.resolvedLanguage)
  return useCallback(
    (value: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parseApiDate(value)),
    [locale],
  )
}

/** A bucket label: the month for a monthly grouping, the day itself for the finer ones. */
export function useFormatBucket(): (value: string, groupBy: GroupBy) => string {
  const { i18n } = useTranslation('finance')
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
  const { i18n } = useTranslation('finance')
  const locale = intlLocale(i18n.resolvedLanguage)
  return useCallback((value: number) => new Intl.NumberFormat(locale).format(value), [locale])
}

/**
 * Which of a category's two names to show.
 *
 * A cooperative may only have filled in one of them, so a missing Kinyarwanda name falls back to
 * the English one rather than leaving a blank cell where the reader expects a category.
 */
export function useCategoryLabel(): (category: { name: string; nameRw: string | null }) => string {
  const { i18n } = useTranslation('finance')
  const preferRw = i18n.resolvedLanguage === 'rw'
  return useCallback(
    (category: { name: string; nameRw: string | null }) =>
      preferRw ? (category.nameRw ?? category.name) : category.name,
    [preferRw],
  )
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

export const RANGE_PRESETS = ['thisMonth', 'lastMonth', 'thisYear'] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]

/**
 * The three periods a cooperative actually asks about.
 *
 * Built from local calendar parts rather than by adding milliseconds, so a month is a month
 * whatever its length and the boundary does not drift.
 */
export function presetRange(preset: RangePreset, today = new Date()): DateRange {
  const year = today.getFullYear()
  const month = today.getMonth()
  if (preset === 'thisYear') {
    return { from: `${year}-01-01`, to: isoDate(new Date(year, 11, 31)) }
  }
  const target = preset === 'lastMonth' ? new Date(year, month - 1, 1) : new Date(year, month, 1)
  const end = new Date(target.getFullYear(), target.getMonth() + 1, 0)
  return { from: isoDate(target), to: isoDate(end) }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** How many days a range covers, used only to pick a sensible grouping. */
function spanDays(range: DateRange): number {
  return (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000
}

/**
 * The grouping a range reads best at, unless the reader chooses otherwise.
 *
 * A month shown by month is one bar and tells nobody anything; a year shown by day is three
 * hundred and sixty-five bars nobody can read. These thresholds keep the chart between roughly
 * ten and forty bars, which is what fits on an office screen.
 */
export function autoGroupBy(range: DateRange): GroupBy {
  const days = spanDays(range)
  if (!Number.isFinite(days) || days <= 45) return 'day'
  if (days <= 200) return 'week'
  return 'month'
}

export interface FinanceRangeState {
  range: DateRange
  groupBy: GroupBy
  /** Which quick choice the current range matches, or `null` when the dates were typed by hand. */
  preset: RangePreset | null
  setRange: (range: DateRange) => void
  setPreset: (preset: RangePreset) => void
  setGroupBy: (groupBy: GroupBy) => void
}

/**
 * The period the overview covers, held in the URL.
 *
 * The dates go into the address rather than into component state so that "what the cooperative
 * held last month" is a link somebody can send to the manager, bookmark, and reach again with the
 * back button. The quick choices write the same two dates a hand-typed range would, so there is
 * one source of truth and no way for a preset and a date field to disagree.
 */
export function useFinanceRange(): FinanceRangeState {
  const [params, setParams] = useSearchParams()

  const fromParam = params.get('from') ?? ''
  const toParam = params.get('to') ?? ''
  const fallback = presetRange('thisMonth')
  const range: DateRange = {
    from: DATE_ONLY.test(fromParam) ? fromParam : fallback.from,
    to: DATE_ONLY.test(toParam) ? toParam : fallback.to,
  }

  const groupByParam = params.get('groupBy')
  const groupBy = GROUP_BYS.find((value) => value === groupByParam) ?? autoGroupBy(range)

  const preset =
    RANGE_PRESETS.find((candidate) => {
      const option = presetRange(candidate)
      return option.from === range.from && option.to === range.to
    }) ?? null

  const write = useCallback(
    (next: { range?: DateRange; groupBy?: GroupBy | null }) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current)
          if (next.range) {
            updated.set('from', next.range.from)
            updated.set('to', next.range.to)
            // A new period gets the grouping that period reads best at, unless the reader is
            // choosing the grouping itself in this same change.
            if (next.groupBy === undefined) updated.delete('groupBy')
          }
          if (next.groupBy) updated.set('groupBy', next.groupBy)
          return updated
        },
        { replace: true },
      )
    },
    [setParams],
  )

  return {
    range,
    groupBy,
    preset,
    setRange: useCallback((value: DateRange) => write({ range: value }), [write]),
    setPreset: useCallback((value: RangePreset) => write({ range: presetRange(value) }), [write]),
    setGroupBy: useCallback((value: GroupBy) => write({ groupBy: value }), [write]),
  }
}

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

/** An amount filter that is not a decimal is dropped rather than sent on to be refused. */
const AMOUNT_FILTER = /^\d{1,12}(\.\d{1,2})?$/

function readAmount(value: string | null): string {
  return value !== null && AMOUNT_FILTER.test(value) ? value : ''
}

function readDate(value: string | null): string {
  return value !== null && DATE_ONLY.test(value) ? value : ''
}

export function readLedgerFiltersFromParams(params: URLSearchParams): LedgerFilters {
  return {
    q: params.get('q') ?? '',
    kind: oneOf<FinanceKind>(FINANCE_KINDS, params.get('kind')),
    categoryId: params.get('categoryId') ?? '',
    memberId: params.get('memberId') ?? '',
    method: oneOf<PaymentMethod>(PAYMENT_METHODS, params.get('method')),
    status: oneOf<FinanceStatus>(FINANCE_STATUSES, params.get('status')),
    from: readDate(params.get('from')),
    to: readDate(params.get('to')),
    minAmount: readAmount(params.get('minAmount')),
    maxAmount: readAmount(params.get('maxAmount')),
    sort: oneOf<FinanceSort>(FINANCE_SORTS, params.get('sort')) || DEFAULT_FINANCE_SORT,
    page: readPage(params.get('page')),
    pageSize: EMPTY_LEDGER_FILTERS.pageSize,
  }
}

/** Only what differs from the default is written, so a shared link stays readable. */
function writeLedgerFiltersToParams(filters: LedgerFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.kind) params.set('kind', filters.kind)
  if (filters.categoryId) params.set('categoryId', filters.categoryId)
  if (filters.memberId) params.set('memberId', filters.memberId)
  if (filters.method) params.set('method', filters.method)
  if (filters.status) params.set('status', filters.status)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.minAmount) params.set('minAmount', filters.minAmount)
  if (filters.maxAmount) params.set('maxAmount', filters.maxAmount)
  if (filters.sort !== DEFAULT_FINANCE_SORT) params.set('sort', filters.sort)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

export interface LedgerFilterState {
  filters: LedgerFilters
  /** Merges changes and returns to page one, unless the change is itself a page. */
  patch: (changes: Partial<LedgerFilters>) => void
  clear: () => void
}

/**
 * The ledger's filters live in the URL rather than in component state, so a view narrowed to one
 * category and one month can be bookmarked, sent to the manager, and reached again by the back
 * button.
 */
export function useLedgerFilters(): LedgerFilterState {
  const [params, setParams] = useSearchParams()

  const patch = useCallback(
    (changes: Partial<LedgerFilters>) => {
      setParams(
        (current) => {
          const merged = { ...readLedgerFiltersFromParams(current), ...changes }
          // Any change to a filter returns to the first page: staying on page four of a narrower
          // result is how a reader ends up looking at an empty table and thinking there is
          // nothing there.
          if (changes.page === undefined) merged.page = 1
          return writeLedgerFiltersToParams(merged)
        },
        // Turning a page is a place you can go back to; retyping a filter is not.
        { replace: changes.page === undefined },
      )
    },
    [setParams],
  )

  const clear = useCallback(() => {
    setParams(new URLSearchParams(), { replace: true })
  }, [setParams])

  return { filters: readLedgerFiltersFromParams(params), patch, clear }
}

export function useTransactionsList(filters: LedgerFilters) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: financeKeys.ledger(cooperativeId, filters),
    queryFn: () => listTransactions(filters),
    enabled: cooperativeId !== null,
  })
}

export function useFinanceSummary(range: DateRange, groupBy: GroupBy) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: financeKeys.summary(cooperativeId, range, groupBy),
    queryFn: () => fetchSummary(range, groupBy),
    enabled: cooperativeId !== null,
  })
}

export function useFinanceTrends(range: DateRange, groupBy: GroupBy) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: financeKeys.trends(cooperativeId, range, groupBy),
    queryFn: () => fetchTrends(range, groupBy),
    enabled: cooperativeId !== null,
  })
}

/**
 * The categories. `enabled` carries whatever condition the caller has — usually that a dialog is
 * open — so a form's options are not fetched until somebody opens the form.
 */
export function useFinanceCategories(
  options: { kind?: FinanceKind; includeInactive?: boolean; enabled?: boolean } = {},
) {
  const cooperativeId = useCooperativeId()
  const includeInactive = options.includeInactive === true
  return useQuery({
    queryKey: financeKeys.categories(cooperativeId, options.kind ?? '', includeInactive),
    queryFn: () =>
      listCategories({
        ...(options.kind ? { kind: options.kind } : {}),
        includeInactive,
      }),
    enabled: options.enabled !== false && cooperativeId !== null,
    staleTime: 5 * 60_000,
  })
}

/** One invalidation for the whole feature, for the reason given on `financeKeys`. */
function useFinanceMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const cooperativeId = useCooperativeId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: financeKeys.scope(cooperativeId) }),
  })
}

/**
 * Records one entry.
 *
 * The retry key is generated per attempt here rather than per dialog opening, which is the
 * conservative choice: a user who corrects a refused amount and submits again is recording
 * something genuinely different, and must not be handed the first attempt's stored response.
 */
export function useRecordTransaction() {
  return useFinanceMutation((input: TransactionInput) =>
    createTransaction(input, newIdempotencyKey()),
  )
}

export function useUpdateTransaction() {
  return useFinanceMutation((input: { id: string; changes: UpdateTransactionInput }) =>
    updateTransaction(input.id, input.changes),
  )
}

export function useVoidTransaction() {
  return useFinanceMutation((input: { id: string; reason: string }) =>
    voidTransaction(input.id, input.reason),
  )
}

export function useCreateCategory() {
  return useFinanceMutation((input: CategoryInput) => createCategory(input))
}

export function useUpdateCategory() {
  return useFinanceMutation((input: { id: string; changes: UpdateCategoryInput }) =>
    updateCategory(input.id, input.changes),
  )
}

/** Downloads the filtered ledger as a file. `saveFile` does the handing over. */
export function useExportFinance() {
  return useMutation({
    mutationFn: (input: { filters: LedgerFilters; format: ExportFormat }) =>
      fetchFinanceExport(input),
    onSuccess: saveFile,
  })
}

/**
 * Bar geometry, in exact integers.
 *
 * A bar needs a height, and a height needs a ratio, which is the one thing this feature cannot
 * get from a decimal string on its own. Rather than putting an amount through a float — which is
 * how a cooperative's books end up a centime out — the string is converted to its exact number of
 * minor units as a `bigint`, the ratio is worked out by integer division to a tenth of a percent,
 * and only that small ratio ever becomes a JavaScript number. No figure shown to the reader comes
 * from any of this: every amount on screen is rendered by `Money` from the original string.
 */
export function toMinorUnits(value: string): bigint {
  const trimmed = value.trim()
  const negative = trimmed.startsWith('-')
  const [whole = '', fraction = ''] = (negative ? trimmed.slice(1) : trimmed).split('.')
  const digits = whole.replace(/\D/g, '') || '0'
  const cents = `${fraction.replace(/\D/g, '')}00`.slice(0, 2)
  const magnitude = BigInt(`${digits}${cents}`)
  return negative ? -magnitude : magnitude
}

function magnitudeOf(value: bigint): bigint {
  return value < 0n ? -value : value
}

/** The largest of a set of amounts, in minor units, which is what a chart scales against. */
export function largestMinorUnits(values: readonly string[]): bigint {
  return values.reduce<bigint>((largest, value) => {
    const candidate = magnitudeOf(toMinorUnits(value))
    return candidate > largest ? candidate : largest
  }, 0n)
}

/** A percentage of the largest bar, to one decimal place, for a CSS height. */
export function barPercent(value: string, largest: bigint): number {
  if (largest <= 0n) return 0
  const magnitude = magnitudeOf(toMinorUnits(value))
  if (magnitude <= 0n) return 0
  const tenths = (magnitude * 1000n) / largest
  return Number(tenths > 1000n ? 1000n : tenths) / 10
}

/** True when a decimal string holds nothing, so a screen can say "none" rather than show a zero. */
export function isZeroAmount(value: string): boolean {
  return toMinorUnits(value) === 0n
}
