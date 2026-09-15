import { type PageMeta } from '@coopmanage/shared'
import {
  apiRequest,
  apiRequestCollection,
  apiRequestFile,
  type DownloadedFile,
} from '@/lib/apiClient'

/**
 * The cooperative's books, as the interface sees them.
 *
 * Three rules from the product brief shape this whole file.
 *
 * **Money is a decimal string from the wire to the screen and back.** No amount here is put
 * through `Number` or `parseFloat`: a float cannot hold a decimal amount exactly, and a
 * cooperative whose books are a franc out cannot close its year. The one place an amount becomes
 * a number at all is the bar geometry in `finance.hooks.ts`, which converts to exact integer
 * minor units rather than to a float, and never shows the result as a figure.
 *
 * **Nothing is ever deleted.** There is no `DELETE` in this module, for an entry or for a
 * category. A wrong figure is voided, which writes a reversal and leaves both rows in the
 * history; a category that has fallen out of use is deactivated, because entries already posted
 * against it still have to be able to say where the money went.
 *
 * **A posted entry's amount, kind and date are fixed for good.** Only its category and its
 * description can still change, which is why `UpdateTransactionInput` has exactly two fields.
 */

export const FINANCE_KINDS = ['INCOME', 'EXPENSE'] as const
export type FinanceKind = (typeof FINANCE_KINDS)[number]

export const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK', 'CHEQUE', 'OTHER'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const FINANCE_STATUSES = ['POSTED', 'VOID'] as const
export type FinanceStatus = (typeof FINANCE_STATUSES)[number]

/**
 * Where an entry came from. `CONTRIBUTION` and `SHARE_PURCHASE` matter to the interface: those
 * two are a member's record seen from the accounting side, and the server refuses to void them
 * from here, so the ledger must not offer a control that could only fail.
 */
export const FINANCE_SOURCE_TYPES = [
  'MANUAL',
  'CONTRIBUTION',
  'SHARE_PURCHASE',
  'SALE',
  'PAYMENT',
  'OTHER',
] as const
export type FinanceSourceType = (typeof FINANCE_SOURCE_TYPES)[number]

/** The source types that have to be corrected from the member's own record instead. */
export const MEMBER_SOURCED: readonly FinanceSourceType[] = ['CONTRIBUTION', 'SHARE_PURCHASE']

export function isMemberSourced(sourceType: string): boolean {
  return MEMBER_SOURCED.some((value) => value === sourceType)
}

/** The six orderings the server accepts. A leading `-` is descending. */
export const FINANCE_SORTS = [
  'occurredAt',
  '-occurredAt',
  'amount',
  '-amount',
  'reference',
  '-reference',
] as const
export type FinanceSort = (typeof FINANCE_SORTS)[number]

export const DEFAULT_FINANCE_SORT: FinanceSort = '-occurredAt'

export const GROUP_BYS = ['day', 'week', 'month'] as const
export type GroupBy = (typeof GROUP_BYS)[number]

export interface TransactionRow {
  id: string
  reference: string
  kind: FinanceKind
  categoryId: string
  categoryName: string
  categoryNameRw: string | null
  /** A decimal string. Always positive: the kind says which side of the balance it falls on. */
  amount: string
  occurredAt: string
  method: PaymentMethod
  description: string
  memberId: string | null
  memberName: string | null
  memberCode: string | null
  status: FinanceStatus
  sourceType: FinanceSourceType
  /** Set when this entry is itself a correction, naming the entry it corrects. */
  reversalOfReference: string | null
  /** Set when this entry has been corrected, naming the correction. */
  reversedByReference: string | null
}

export interface TransactionDetail extends TransactionRow {
  voidReason: string | null
  voidedAt: string | null
  createdAt: string
}

/** The two figures the books are made of, and the difference between them. */
export interface FinanceTotals {
  income: string
  expenses: string
  balance: string
}

export const ZERO_TOTALS: FinanceTotals = { income: '0.00', expenses: '0.00', balance: '0.00' }

/**
 * Every filter the ledger can apply, all as strings so the whole shape round-trips through the
 * URL and can be used verbatim as a query key.
 */
export interface LedgerFilters {
  q: string
  kind: FinanceKind | ''
  categoryId: string
  memberId: string
  method: PaymentMethod | ''
  status: FinanceStatus | ''
  from: string
  to: string
  minAmount: string
  maxAmount: string
  sort: FinanceSort
  page: number
  pageSize: number
}

export const EMPTY_LEDGER_FILTERS: LedgerFilters = {
  q: '',
  kind: '',
  categoryId: '',
  memberId: '',
  method: '',
  status: '',
  from: '',
  to: '',
  minAmount: '',
  maxAmount: '',
  sort: DEFAULT_FINANCE_SORT,
  page: 1,
  pageSize: 25,
}

/** The filters that narrow the ledger, as opposed to ordering and paging it. */
export function countActiveLedgerFilters(filters: LedgerFilters): number {
  return [
    filters.q,
    filters.kind,
    filters.categoryId,
    filters.memberId,
    filters.method,
    filters.status,
    filters.from,
    filters.to,
    filters.minAmount,
    filters.maxAmount,
  ].filter((value) => value !== '').length
}

function ledgerQuery(filters: LedgerFilters): Record<string, string | number> {
  return {
    q: filters.q,
    kind: filters.kind,
    categoryId: filters.categoryId,
    memberId: filters.memberId,
    method: filters.method,
    status: filters.status,
    from: filters.from,
    to: filters.to,
    minAmount: filters.minAmount,
    maxAmount: filters.maxAmount,
    sort: filters.sort,
    page: filters.page,
    pageSize: filters.pageSize,
  }
}

export interface LedgerPage {
  items: TransactionRow[]
  meta: PageMeta | undefined
  /**
   * The income, expenses and balance of the **whole filtered set**, not of the rows on screen.
   * That is the figure a treasurer is actually asked for when they narrow the ledger to a month.
   */
  totals: FinanceTotals
}

/**
 * Reads `meta.totals` without asserting it into existence.
 *
 * The collection helper types its metadata as `PageMeta`, which is the shape every list endpoint
 * shares; this endpoint adds the filtered totals on top. Rather than casting the metadata into a
 * wider type and hoping, the three fields are checked one at a time and a missing or malformed
 * block falls back to zeros, so a server that stops sending them shows nothing rather than
 * crashing the screen a treasurer is reading.
 */
function readTotals(meta: PageMeta | undefined): FinanceTotals {
  if (meta === undefined || !('totals' in meta)) return ZERO_TOTALS
  const { totals } = meta
  if (typeof totals !== 'object' || totals === null) return ZERO_TOTALS
  if (!('income' in totals) || !('expenses' in totals) || !('balance' in totals)) return ZERO_TOTALS
  const { income, expenses, balance } = totals
  if (typeof income !== 'string' || typeof expenses !== 'string' || typeof balance !== 'string') {
    return ZERO_TOTALS
  }
  return { income, expenses, balance }
}

export async function listTransactions(filters: LedgerFilters): Promise<LedgerPage> {
  // The API client drops empty strings, so an unset filter is simply not sent.
  const response = await apiRequestCollection<TransactionRow>('/finance/transactions', {
    query: ledgerQuery(filters),
  })
  return { items: response.items, meta: response.meta, totals: readTotals(response.meta) }
}

export interface TransactionInput {
  kind: FinanceKind
  categoryId: string
  /** A decimal string, exactly as it was typed. Never a JavaScript number. */
  amount: string
  /** Omitted to mean today, which is what the server does with an absent value. */
  occurredAt?: string
  method: PaymentMethod
  description: string
}

/**
 * A retry key, so a dropped connection on a POST cannot record the same money twice.
 *
 * The server keys the idempotency record on this value, and replies to a replay with the first
 * attempt's own response. `crypto.randomUUID` is present in every browser this product supports,
 * but not in every test environment, so there is a fallback rather than a crash on a screen whose
 * whole job is recording money.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function createTransaction(
  input: TransactionInput,
  idempotencyKey: string,
): Promise<TransactionDetail> {
  return apiRequest<TransactionDetail>('/finance/transactions', {
    method: 'POST',
    body: input,
    idempotencyKey,
  })
}

export function fetchTransaction(id: string): Promise<TransactionDetail> {
  return apiRequest<TransactionDetail>(`/finance/transactions/${id}`)
}

/**
 * The only two fields a posted entry can still change.
 *
 * The amount, the kind and the date are absent on purpose rather than by oversight: a figure that
 * could change after the fact would change a report somebody has already printed and signed.
 */
export interface UpdateTransactionInput {
  categoryId?: string
  description?: string
}

export function updateTransaction(
  id: string,
  changes: UpdateTransactionInput,
): Promise<TransactionDetail> {
  return apiRequest<TransactionDetail>(`/finance/transactions/${id}`, {
    method: 'PATCH',
    body: changes,
  })
}

export interface VoidedPair {
  voided: { id: string; reference: string; kind: FinanceKind; amount: string }
  /** The entry written to cancel the other one out. Named on screen, so the correction is
   * something the reader can go and look at rather than a figure that quietly moved. */
  reversal: { id: string; reference: string; kind: FinanceKind; amount: string }
}

export function voidTransaction(id: string, reason: string): Promise<VoidedPair> {
  return apiRequest<VoidedPair>(`/finance/transactions/${id}/void`, {
    method: 'POST',
    body: { reason },
  })
}

export interface SummaryBucket {
  /** The first day the bucket covers. Buckets with no entries are present, with zeros. */
  start: string
  income: string
  expenses: string
  net: string
}

export interface CategoryBreakdownRow {
  categoryId: string
  name: string
  nameRw: string | null
  kind: FinanceKind
  total: string
  /** A percentage of that kind's total, to one decimal place, already computed by the server so
   * the interface needs no arithmetic over money to draw a share. */
  share: string
}

export interface FinanceSummary {
  from: string
  to: string
  groupBy: GroupBy
  /** What the cooperative held the day before the range began. */
  opening: string
  income: string
  expenses: string
  net: string
  closing: string
  buckets: SummaryBucket[]
  categories: CategoryBreakdownRow[]
}

export interface DateRange {
  from: string
  to: string
}

/** Both dates are required by the server: a summary with no range reports a period nobody chose. */
export function fetchSummary(
  range: DateRange,
  groupBy: GroupBy,
  categoryId = '',
): Promise<FinanceSummary> {
  return apiRequest<FinanceSummary>('/finance/summary', {
    query: { from: range.from, to: range.to, groupBy, categoryId },
  })
}

export interface TrendPoint {
  start: string
  income: string
  expenses: string
  net: string
  /** The running balance at the end of this bucket, carried forward from the opening balance. */
  balance: string
}

export interface FinanceTrends {
  groupBy: GroupBy
  opening: string
  points: TrendPoint[]
}

export function fetchTrends(range: DateRange, groupBy: GroupBy): Promise<FinanceTrends> {
  return apiRequest<FinanceTrends>('/finance/trends', {
    query: { from: range.from, to: range.to, groupBy },
  })
}

export const EXPORT_FORMATS = ['csv', 'xlsx'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

// `DownloadedFile` now comes from the API client, so every download in the application describes
// itself the same way.
export type { DownloadedFile }

/**
 * The ledger as a file, under exactly the filters currently on screen.
 *
 * `apiRequestFile` carries the language, the token, the cooperative header and — the reason this
 * no longer assembles its own request — one silent refresh and replay on an expired token. An
 * access token lasts fifteen minutes and this screen is often read for longer than that before
 * anybody asks for the file; the earlier version of this call reported "the export could not be
 * produced" in exactly that case.
 */
export async function fetchFinanceExport(input: {
  filters: LedgerFilters
  format: ExportFormat
}): Promise<DownloadedFile> {
  const query: Record<string, string> = { format: input.format }
  for (const [key, value] of Object.entries(ledgerQuery(input.filters))) {
    // Paging does not apply to a file: the export always covers the whole filtered set.
    if (key === 'page' || key === 'pageSize') continue
    if (value !== '' && value !== undefined) query[key] = String(value)
  }

  return apiRequestFile('/finance/export', {
    query,
    accept: input.format === 'csv' ? 'text/csv' : 'application/octet-stream',
    fallbackFilename: `finance.${input.format}`,
  })
}

export interface CategoryRow {
  id: string
  kind: FinanceKind
  name: string
  nameRw: string | null
  code: string | null
  isActive: boolean
  /** A category the system created. It can be renamed, but its origin is worth showing. */
  isSystem: boolean
  /** How many entries are posted against it, so the screen can say what deactivating costs. */
  entryCount: number
  total: string
}

/**
 * The categories, optionally of one kind only.
 *
 * `includeInactive` defaults to false on the server, which is what a form wants: an entry should
 * never be posted to a category the cooperative has retired. The categories screen asks for all
 * of them, because a retired category still has to be findable and restorable.
 */
export function listCategories(options: {
  kind?: FinanceKind
  includeInactive?: boolean
}): Promise<CategoryRow[]> {
  return apiRequest<CategoryRow[]>('/finance/categories', {
    query: {
      kind: options.kind ?? '',
      includeInactive: options.includeInactive === true ? 'true' : 'false',
    },
  })
}

export interface CategoryInput {
  kind: FinanceKind
  name: string
  nameRw?: string
  code?: string
}

export function createCategory(input: CategoryInput): Promise<CategoryRow> {
  return apiRequest<CategoryRow>('/finance/categories', { method: 'POST', body: input })
}

/**
 * Everything a category can still change.
 *
 * `kind` is absent for the same reason an entry's amount is: moving a category from income to
 * expense would flip the sign of every entry already posted against it and silently rewrite
 * months that have already been reported on. A category is also never removed — `isActive: false`
 * is the only removal there is.
 */
export interface UpdateCategoryInput {
  name?: string
  nameRw?: string | null
  code?: string | null
  isActive?: boolean
}

export function updateCategory(id: string, changes: UpdateCategoryInput): Promise<CategoryRow> {
  return apiRequest<CategoryRow>(`/finance/categories/${id}`, { method: 'PATCH', body: changes })
}
