import type { PageMeta } from '@coopmanage/shared'
import { apiRequest, apiRequestCollection } from '@/lib/apiClient'
// A sale takes payment in the same transaction that records it, so the payment methods and the
// retry-key helper are the books' definitions rather than a second copy of them. That is what
// keeps a sale's method and a ledger entry's method from drifting apart.
import {
  newIdempotencyKey,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@/features/finance/finance.api'

export { newIdempotencyKey, PAYMENT_METHODS, type PaymentMethod }

/**
 * Buyers and sales, as the interface sees them.
 *
 * Four rules from the product brief shape this whole file.
 *
 * **Money is a decimal string with two places and a quantity one with three, from the wire to the
 * screen and back.** Nothing here is put through `Number` or `parseFloat`: a sale is arithmetic a
 * cooperative will be held to by a buyer, and a float cannot hold a decimal amount exactly. The
 * few figures the form works out for itself are computed in exact integer minor units with
 * `BigInt`, which is the same technique the finance charts use, and the result is a decimal string
 * again before anybody reads it.
 *
 * **A sale is a draft until somebody confirms it.** A draft moves no stock and records no money,
 * which is why it can be edited freely and why it is deliberately accepted for more than the store
 * holds: a sale is often written up before the stock is counted. Confirmation is the single act
 * that makes it real, and it is the request where a retry matters most in the product.
 *
 * **The server prices the sale and is the authority.** The form shows a subtotal, a discount, a tax
 * figure and a total so the person at the counter can check them against what they are about to
 * agree, and sends none of them: only the lines, the discount and the tax go on the wire.
 *
 * **Nothing is deleted.** There is no `DELETE` here. A draft nobody wants is cancelled, a confirmed
 * sale is cancelled with compensating movements and a reversed income entry, and a buyer is taken
 * out of use — because every confirmed sale names them and a report covering last season still has
 * to be able to say who bought the maize.
 */

// ---------------------------------------------------------------------------
// Exact arithmetic over decimal strings
// ---------------------------------------------------------------------------

/**
 * Money as its exact number of minor units.
 *
 * Reading the characters rather than parsing the value is the whole point: `parseFloat('0.1')` is
 * already not a tenth, and a sale whose lines are each a centime out is a receipt a buyer can
 * dispute. Anything past the second decimal place is dropped rather than rounded, which cannot
 * happen for a value this module validated first.
 */
function toMinorUnits(value: string, places: number): bigint {
  const trimmed = value.trim()
  const negative = trimmed.startsWith('-')
  const [whole = '', fraction = ''] = (negative ? trimmed.slice(1) : trimmed).split('.')
  const digits = whole.replace(/\D/g, '') || '0'
  const decimals = `${fraction.replace(/\D/g, '')}${'0'.repeat(places)}`.slice(0, places)
  const magnitude = BigInt(`${digits}${decimals}`)
  return negative ? -magnitude : magnitude
}

function fromMinorUnits(value: bigint, places: number): string {
  const negative = value < 0n
  const magnitude = negative ? -value : value
  const unit = 10n ** BigInt(places)
  const whole = magnitude / unit
  const fraction = (magnitude % unit).toString().padStart(places, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

/**
 * Half-up division, which is what a person doing the sum on paper would do and what the server's
 * own money library does. Away from zero on a half, so a negative figure rounds the same way its
 * positive counterpart would.
 */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n
  const magnitude = negative ? -numerator : numerator
  const quotient = magnitude / denominator
  const remainder = magnitude % denominator
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient
  return negative ? -rounded : rounded
}

export const MONEY_PLACES = 2
export const QUANTITY_PLACES = 3

/** Two decimal places always, so a total never has to be guessed at. */
export function addMoney(...values: string[]): string {
  const total = values.reduce<bigint>((sum, value) => sum + toMinorUnits(value, MONEY_PLACES), 0n)
  return fromMinorUnits(total, MONEY_PLACES)
}

export function subtractMoney(a: string, b: string): string {
  return fromMinorUnits(toMinorUnits(a, MONEY_PLACES) - toMinorUnits(b, MONEY_PLACES), MONEY_PLACES)
}

/** -1, 0 or 1. Never compares amounts with `<`, which would coerce them to floats. */
export function compareMoney(a: string, b: string): -1 | 0 | 1 {
  const left = toMinorUnits(a, MONEY_PLACES)
  const right = toMinorUnits(b, MONEY_PLACES)
  return left < right ? -1 : left > right ? 1 : 0
}

export function isZeroMoney(value: string): boolean {
  return toMinorUnits(value, MONEY_PLACES) === 0n
}

/**
 * What one line comes to.
 *
 * Rounded once, here, because a line total is a real amount that gets stored and a buyer reads it,
 * and because the subtotal then adds up figures that are already rounded — which is what somebody
 * checking the receipt by hand would get. The server rounds in exactly the same place, so the
 * figure the counter saw and the figure in the books agree.
 */
export function lineTotalOf(unitPrice: string, quantity: string): string {
  const product = toMinorUnits(unitPrice, MONEY_PLACES) * toMinorUnits(quantity, QUANTITY_PLACES)
  const cents = divideHalfUp(product, 10n ** BigInt(QUANTITY_PLACES))
  return fromMinorUnits(cents, MONEY_PLACES)
}

/** True when a quantity asks for more than the figure alongside it. Used for a warning, never a block. */
export function exceedsQuantity(asked: string, available: string): boolean {
  return toMinorUnits(asked, QUANTITY_PLACES) > toMinorUnits(available, QUANTITY_PLACES)
}

/** A percentage of the largest amount in a set, to one decimal place, for a CSS bar height. */
export function largestMoney(values: readonly string[]): bigint {
  return values.reduce<bigint>((largest, value) => {
    const candidate = toMinorUnits(value, MONEY_PLACES)
    const magnitude = candidate < 0n ? -candidate : candidate
    return magnitude > largest ? magnitude : largest
  }, 0n)
}

export function barPercent(value: string, largest: bigint): number {
  if (largest <= 0n) return 0
  const candidate = toMinorUnits(value, MONEY_PLACES)
  const magnitude = candidate < 0n ? -candidate : candidate
  if (magnitude <= 0n) return 0
  const tenths = (magnitude * 1000n) / largest
  // Only this small ratio ever becomes a JavaScript number, and it is never shown as a figure.
  return Number(tenths > 1000n ? 1000n : tenths) / 10
}

// ---------------------------------------------------------------------------
// What a field may hold
// ---------------------------------------------------------------------------

/** Money: up to twelve whole digits and at most two decimal places, checked as characters. */
export const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/

/** A quantity: up to eleven whole digits and at most three, which is what `numeric(14,3)` holds. */
export const QUANTITY_PATTERN = /^\d{1,11}(\.\d{1,3})?$/

export function isMoney(value: string): boolean {
  return MONEY_PATTERN.test(value.trim())
}

/**
 * A price of `"0"` is accepted, because that is how something given away with a sale is recorded
 * rather than by leaving it off the receipt.
 */
export function isPrice(value: string): boolean {
  return isMoney(value)
}

export function isPositiveMoney(value: string): boolean {
  const trimmed = value.trim()
  return MONEY_PATTERN.test(trimmed) && /[1-9]/.test(trimmed)
}

export function isPositiveQuantity(value: string): boolean {
  const trimmed = value.trim()
  return QUANTITY_PATTERN.test(trimmed) && /[1-9]/.test(trimmed)
}

// ---------------------------------------------------------------------------
// Buyers
// ---------------------------------------------------------------------------

export const BUYER_SORTS = ['name', '-name'] as const
export type BuyerSort = (typeof BUYER_SORTS)[number]

export const DEFAULT_BUYER_SORT: BuyerSort = 'name'

export interface BuyerRow {
  id: string
  name: string
  organization: string | null
  contactPerson: string | null
  phone: string | null
  email: string | null
  tin: string | null
  province: string | null
  district: string | null
  sector: string | null
  address: string | null
  notes: string | null
  isActive: boolean
  /**
   * The three figures below count **confirmed sales only**. A draft is an intention somebody
   * typed, not business the cooperative did, so counting it would overstate every buyer's history.
   */
  saleCount: number
  totalSold: string
  outstanding: string
  lastSaleDate: string | null
}

export interface BuyerFilters {
  q: string
  includeInactive: boolean
  sort: BuyerSort
  page: number
  pageSize: number
}

export const EMPTY_BUYER_FILTERS: BuyerFilters = {
  q: '',
  includeInactive: false,
  sort: DEFAULT_BUYER_SORT,
  page: 1,
  pageSize: 25,
}

export function countActiveBuyerFilters(filters: BuyerFilters): number {
  return [filters.q, filters.includeInactive ? 'yes' : ''].filter((value) => value !== '').length
}

export interface BuyerPage {
  items: BuyerRow[]
  meta: PageMeta | undefined
}

export async function listBuyers(filters: BuyerFilters): Promise<BuyerPage> {
  const response = await apiRequestCollection<BuyerRow>('/buyers', {
    query: {
      q: filters.q,
      includeInactive: filters.includeInactive ? 'true' : 'false',
      sort: filters.sort,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  })
  return { items: response.items, meta: response.meta }
}

export function fetchBuyer(id: string): Promise<BuyerRow> {
  return apiRequest<BuyerRow>(`/buyers/${id}`)
}

/**
 * A name and nothing else is required, for the same reason a member needs only a name: whoever
 * records a sale at the store has the buyer's name and may have nothing else, and refusing the
 * sale until somebody finds a telephone number would mean the sale goes unrecorded.
 */
export interface BuyerInput {
  name: string
  organization?: string
  contactPerson?: string
  phone?: string
  email?: string
  tin?: string
  province?: string
  district?: string
  sector?: string
  address?: string
  notes?: string
}

export function createBuyer(input: BuyerInput): Promise<BuyerRow> {
  return apiRequest<BuyerRow>('/buyers', { method: 'POST', body: input })
}

/**
 * What a buyer can still change.
 *
 * Every optional field takes `null` as well as a string, because clearing a telephone number that
 * was written down wrongly has to be possible: an omitted field means "leave it alone" and an
 * explicit `null` means "there is nothing here". `isActive` is the only removal there is — a buyer
 * is taken out of use, never deleted.
 */
export interface UpdateBuyerInput {
  name?: string
  organization?: string | null
  contactPerson?: string | null
  phone?: string | null
  email?: string | null
  tin?: string | null
  province?: string | null
  district?: string | null
  sector?: string | null
  address?: string | null
  notes?: string | null
  isActive?: boolean
}

export function updateBuyer(id: string, changes: UpdateBuyerInput): Promise<BuyerRow> {
  return apiRequest<BuyerRow>(`/buyers/${id}`, { method: 'PATCH', body: changes })
}

export interface BuyerSummary {
  buyer: BuyerRow
  sales: SaleRow[]
  totals: SalesTotals
}

/** Needs `buyers:view` and `sales:view` together, so a caller without both must not ask. */
export function fetchBuyerSummary(id: string): Promise<BuyerSummary> {
  return apiRequest<BuyerSummary>(`/buyers/${id}/summary`)
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export const SALE_STATUSES = ['DRAFT', 'CONFIRMED', 'CANCELLED'] as const
export type SaleStatus = (typeof SALE_STATUSES)[number]

export const PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const SALE_SORTS = [
  'saleDate',
  '-saleDate',
  'total',
  '-total',
  'reference',
  '-reference',
] as const
export type SaleSort = (typeof SALE_SORTS)[number]

export const DEFAULT_SALE_SORT: SaleSort = '-saleDate'

export const GROUP_BYS = ['day', 'week', 'month'] as const
export type GroupBy = (typeof GROUP_BYS)[number]

export interface SaleLineRow {
  id: string
  productId: string
  productName: string
  sku: string
  unitId: string
  unitSymbol: string
  quantity: string
  unitPrice: string
  lineTotal: string
  note: string | null
  position: number
}

export interface SaleRow {
  id: string
  reference: string
  buyerId: string
  buyerName: string
  warehouseId: string
  warehouseName: string
  saleDate: string
  status: SaleStatus
  paymentStatus: PaymentStatus
  subtotal: string
  discount: string
  taxAmount: string
  total: string
  amountPaid: string
  /** What is still owed. The figure a treasurer chases. */
  outstanding: string
  note: string | null
  confirmedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  lineCount: number
}

export interface SalePaymentRow {
  id: string
  reference: string
  amount: string
  method: string
  occurredAt: string
}

export interface SaleMovementRow {
  id: string
  reference: string
  productName: string
  quantity: string
}

export interface SaleDetail extends SaleRow {
  lines: SaleLineRow[]
  payments: SalePaymentRow[]
  /** The stock that left, which is empty until the sale is confirmed. */
  movements: SaleMovementRow[]
}

/** Sold, paid and still owed, over confirmed sales only. */
export interface SalesTotals {
  sold: string
  paid: string
  outstanding: string
}

export const ZERO_SALES_TOTALS: SalesTotals = {
  sold: '0.00',
  paid: '0.00',
  outstanding: '0.00',
}

export interface SaleFilters {
  q: string
  buyerId: string
  warehouseId: string
  status: SaleStatus | ''
  paymentStatus: PaymentStatus | ''
  from: string
  to: string
  sort: SaleSort
  page: number
  pageSize: number
}

export const EMPTY_SALE_FILTERS: SaleFilters = {
  q: '',
  buyerId: '',
  warehouseId: '',
  status: '',
  paymentStatus: '',
  from: '',
  to: '',
  sort: DEFAULT_SALE_SORT,
  page: 1,
  pageSize: 25,
}

export function countActiveSaleFilters(filters: SaleFilters): number {
  return [
    filters.q,
    filters.buyerId,
    filters.warehouseId,
    filters.status,
    filters.paymentStatus,
    filters.from,
    filters.to,
  ].filter((value) => value !== '').length
}

export interface SalesPage {
  items: SaleRow[]
  meta: PageMeta | undefined
  /**
   * The figures for the **whole filtered set** and for confirmed sales only, rather than for the
   * rows on screen. That is what a manager asked what the cooperative sold last month is after.
   */
  totals: SalesTotals
}

/**
 * Reads `meta.totals` without asserting it into existence.
 *
 * The collection helper types its metadata as `PageMeta`, the shape every list endpoint shares;
 * this endpoint adds the three figures on top. Rather than casting the metadata into a wider type
 * and hoping, each field is checked one at a time and a missing or malformed block falls back to
 * zeros, so a server that stops sending them shows nothing rather than crashing the screen.
 */
function readTotals(meta: PageMeta | undefined): SalesTotals {
  if (meta === undefined || !('totals' in meta)) return ZERO_SALES_TOTALS
  const { totals } = meta
  if (typeof totals !== 'object' || totals === null) return ZERO_SALES_TOTALS
  if (!('sold' in totals) || !('paid' in totals) || !('outstanding' in totals)) {
    return ZERO_SALES_TOTALS
  }
  const { sold, paid, outstanding } = totals
  if (typeof sold !== 'string' || typeof paid !== 'string' || typeof outstanding !== 'string') {
    return ZERO_SALES_TOTALS
  }
  return { sold, paid, outstanding }
}

export async function listSales(filters: SaleFilters): Promise<SalesPage> {
  // The API client drops empty strings, so an unset filter is simply not sent and the server's own
  // default applies instead of a value this screen invented.
  const response = await apiRequestCollection<SaleRow>('/sales', {
    query: {
      q: filters.q,
      buyerId: filters.buyerId,
      warehouseId: filters.warehouseId,
      status: filters.status,
      paymentStatus: filters.paymentStatus,
      from: filters.from,
      to: filters.to,
      sort: filters.sort,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  })
  return { items: response.items, meta: response.meta, totals: readTotals(response.meta) }
}

export function fetchSale(id: string): Promise<SaleDetail> {
  return apiRequest<SaleDetail>(`/sales/${id}`)
}

export interface SaleLineInput {
  productId: string
  /** Decimal strings, exactly as they were typed. Never JavaScript numbers. */
  quantity: string
  unitPrice: string
  note?: string
}

/**
 * What a sale is written up from.
 *
 * There is no `total`, `subtotal` or `lineTotal` field, and that is deliberate: the server prices
 * the sale from the lines and is the authority on what it comes to. Sending a total the interface
 * worked out would create two figures that can disagree, and the one on the receipt would be the
 * one nobody checked.
 */
export interface SaleInput {
  buyerId: string
  warehouseId: string
  saleDate?: string
  lines: SaleLineInput[]
  discount?: string
  taxAmount?: string
  note?: string
}

export function createSale(input: SaleInput): Promise<SaleDetail> {
  return apiRequest<SaleDetail>('/sales', { method: 'POST', body: input })
}

/**
 * Editing a draft. The lines are replaced wholesale rather than patched one at a time, because a
 * sale is read and corrected as a whole and a line-by-line protocol would leave the subtotal
 * disagreeing with the lines between two requests.
 */
export interface UpdateSaleInput {
  buyerId?: string
  warehouseId?: string
  saleDate?: string
  lines?: SaleLineInput[]
  discount?: string
  taxAmount?: string
  note?: string
}

export function updateSale(id: string, changes: UpdateSaleInput): Promise<SaleDetail> {
  return apiRequest<SaleDetail>(`/sales/${id}`, { method: 'PATCH', body: changes })
}

export interface ConfirmSaleInput {
  /** Omitted when nothing was taken at the counter, which leaves the sale unpaid. */
  amountPaid?: string
  method?: PaymentMethod
  /** Required by the server whenever an amount is given, because the money lands in the books. */
  incomeCategoryId?: string
}

/**
 * The one act that makes a sale real: the stock comes out, a movement is written per line, any
 * payment is recorded, and the sale is marked, all in one transaction.
 *
 * The retry key is generated per attempt rather than per dialog opening. This is the request where
 * it matters most in the whole product — a storekeeper on a slow connection pressing Confirm twice
 * would otherwise empty the shelf twice over — and per attempt is still the conservative choice,
 * because somebody who corrects a refused amount and submits again is recording something
 * genuinely different and must not be handed the first attempt's stored response.
 */
export function confirmSale(id: string, input: ConfirmSaleInput): Promise<SaleDetail> {
  return apiRequest<SaleDetail>(`/sales/${id}/confirm`, {
    method: 'POST',
    body: input,
    idempotencyKey: newIdempotencyKey(),
  })
}

/**
 * Cancelling. A confirmed sale is cancelled with compensating `SALE_RETURN` movements and the
 * income is reversed; both are new entries rather than deletions, so the history still says what
 * happened and what undid it. A draft is simply cancelled, because nothing had moved.
 */
export function cancelSale(id: string, reason: string): Promise<SaleDetail> {
  return apiRequest<SaleDetail>(`/sales/${id}/cancel`, {
    method: 'POST',
    body: { reason },
    idempotencyKey: newIdempotencyKey(),
  })
}

export interface SalePaymentInput {
  amount: string
  method: PaymentMethod
  /** Required. The money has to land somewhere in the books. */
  incomeCategoryId: string
  paidOn?: string
  note?: string
}

/** Needs `finance:create`, not a sales permission, because it writes an entry into the books. */
export function recordSalePayment(id: string, input: SalePaymentInput): Promise<SaleDetail> {
  return apiRequest<SaleDetail>(`/sales/${id}/payments`, {
    method: 'POST',
    body: input,
    idempotencyKey: newIdempotencyKey(),
  })
}

export interface SaleReceipt {
  sale: SaleDetail
  cooperative: { name: string; code: string; district: string; sector: string }
  buyer: BuyerRow
  /** When the receipt was produced, so two copies of the same sale can be told apart. */
  issuedAt: string
  issuedBy: string
}

/**
 * Everything a receipt needs, in one request, with every figure already a rounded string so that
 * nothing in the printing path can arrive at a different total from the books.
 *
 * Reading it writes an audit entry on the server, which is why the interface asks for it when
 * somebody opens the receipt rather than alongside the sale itself.
 */
export function fetchReceipt(id: string): Promise<SaleReceipt> {
  return apiRequest<SaleReceipt>(`/sales/${id}/receipt`)
}

export interface DateRange {
  from: string
  to: string
}

export interface SalesSummaryBucket {
  start: string
  sold: string
  saleCount: number
}

export interface TopBuyer {
  buyerId: string
  name: string
  sold: string
  saleCount: number
}

export interface TopProduct {
  productId: string
  name: string
  sku: string
  quantity: string
  sold: string
}

export interface SalesSummary {
  from: string
  to: string
  groupBy: string
  sold: string
  paid: string
  outstanding: string
  saleCount: number
  /** Empty periods are present as zero, so a chart never draws between two non-adjacent points. */
  buckets: SalesSummaryBucket[]
  topBuyers: TopBuyer[]
  topProducts: TopProduct[]
}

/** Both dates are required by the server: a summary with no range reports a period nobody chose. */
export function fetchSalesSummary(range: DateRange, groupBy: GroupBy): Promise<SalesSummary> {
  return apiRequest<SalesSummary>('/sales/summary', {
    query: { from: range.from, to: range.to, groupBy },
  })
}
