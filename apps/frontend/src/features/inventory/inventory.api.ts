import type { PageMeta } from '@coopmanage/shared'
import { apiRequest, apiRequestCollection } from '@/lib/apiClient'
// A receipt can post the expense that paid for it in the same transaction, so the store and the
// books already meet in the database. Rather than restating the payment methods and the retry-key
// helper here, the store borrows the definitions the books already own, which is what keeps a
// receipt's method and a ledger entry's method from drifting apart.
import {
  newIdempotencyKey,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@/features/finance/finance.api'

export { newIdempotencyKey, PAYMENT_METHODS, type PaymentMethod }

/**
 * The cooperative's store and its catalogue, as the interface sees them.
 *
 * Three rules from the product brief shape this whole file.
 *
 * **A quantity is a decimal string from the wire to the screen and back.** The server holds
 * quantities as `numeric(14,3)` because a cooperative weighs to the gram, and 0.1 of a kilogram
 * cannot be held exactly in a float. So no quantity here is put through `Number`, `parseFloat` or
 * any arithmetic: the characters the server sent are the characters the screen shows, and the
 * characters the user typed are the characters the server receives. Money behaves the same way,
 * with two decimal places instead of three.
 *
 * **Nothing is ever deleted.** There is no `DELETE` in this module. A movement recorded in error
 * is reversed by an opposite movement that points at it and both stay in the history; a product
 * is retired, a store is closed, a unit is put out of service. That is what lets a report
 * covering last season still say what was received and in what unit.
 *
 * **A correction is described by what was counted, not by the difference.** The adjust endpoint
 * takes `countedQuantity` and works out for itself whether the correction is up or down, because
 * asking a storekeeper to decide the sign is how the wrong one gets recorded.
 */

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export interface UnitRow {
  id: string
  key: string
  nameEn: string
  nameRw: string
  symbol: string
  /** Decimal places the unit is measured to. A sack is counted whole; a weight is not. */
  precision: number
  isActive: boolean
  /**
   * True for a unit the platform seeded. Every cooperative shares those, so none of them may be
   * renamed: a `PATCH` against one is refused with `errors.catalogue.systemUnit`.
   */
  isSystem: boolean
  baseUnitId: string | null
  factorToBase: string | null
  productCount: number
}

export function listUnits(includeInactive: boolean): Promise<UnitRow[]> {
  return apiRequest<UnitRow[]>('/units', {
    query: { includeInactive: includeInactive ? 'true' : 'false' },
  })
}

export interface UnitInput {
  /** Upper-case letters, digits and underscores. Stable, because paper refers to it. */
  key: string
  nameEn: string
  nameRw: string
  symbol: string
  precision: number
  baseUnitId?: string
  factorToBase?: string
}

export function createUnit(input: UnitInput): Promise<UnitRow> {
  return apiRequest<UnitRow>('/units', { method: 'POST', body: input })
}

/**
 * Everything a unit can still change.
 *
 * The key and the precision are absent on purpose. The key is what paper and code refer to, and
 * the precision is the number of decimal places every quantity already recorded in this unit was
 * rounded to: loosening or tightening it afterwards would silently restate history.
 */
export interface UpdateUnitInput {
  nameEn?: string
  nameRw?: string
  symbol?: string
  isActive?: boolean
}

export function updateUnit(id: string, changes: UpdateUnitInput): Promise<UnitRow> {
  return apiRequest<UnitRow>(`/units/${id}`, { method: 'PATCH', body: changes })
}

// ---------------------------------------------------------------------------
// Product categories
// ---------------------------------------------------------------------------

export interface ProductCategoryRow {
  id: string
  name: string
  nameRw: string | null
  parentId: string | null
  parentName: string | null
  description: string | null
  isActive: boolean
  productCount: number
}

export function listProductCategories(includeInactive: boolean): Promise<ProductCategoryRow[]> {
  return apiRequest<ProductCategoryRow[]>('/product-categories', {
    query: { includeInactive: includeInactive ? 'true' : 'false' },
  })
}

export interface ProductCategoryInput {
  name: string
  nameRw?: string
  /** Nesting is one level only: a parent that already has a parent is refused. */
  parentId?: string
  description?: string
}

export function createProductCategory(input: ProductCategoryInput): Promise<ProductCategoryRow> {
  return apiRequest<ProductCategoryRow>('/product-categories', { method: 'POST', body: input })
}

export interface UpdateProductCategoryInput {
  name?: string
  nameRw?: string | null
  description?: string | null
  isActive?: boolean
}

export function updateProductCategory(
  id: string,
  changes: UpdateProductCategoryInput,
): Promise<ProductCategoryRow> {
  return apiRequest<ProductCategoryRow>(`/product-categories/${id}`, {
    method: 'PATCH',
    body: changes,
  })
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const PRODUCT_TYPES = ['GOODS', 'SERVICE'] as const
export type ProductType = (typeof PRODUCT_TYPES)[number]

export const PRODUCT_SORTS = ['name', '-name', 'sku', '-sku'] as const
export type ProductSort = (typeof PRODUCT_SORTS)[number]

export const DEFAULT_PRODUCT_SORT: ProductSort = 'name'

export interface ProductRow {
  id: string
  sku: string
  name: string
  nameRw: string | null
  categoryId: string | null
  categoryName: string | null
  unitId: string
  unitSymbol: string
  unitName: string
  type: ProductType
  trackInventory: boolean
  minStockLevel: string | null
  defaultPurchasePrice: string | null
  defaultSalePrice: string | null
  description: string | null
  isActive: boolean
  /** Held across every store. Null for a product nobody counts, rather than a zero. */
  quantityOnHand: string | null
  /**
   * True once any movement names this product, which freezes its unit and whether it is counted.
   * The edit form disables both controls on the strength of this flag, so the reader is told why
   * rather than being allowed to submit something the server will refuse.
   */
  hasMovements: boolean
}

/** Every filter the catalogue can apply, all as strings so the shape round-trips through the URL. */
export interface ProductFilters {
  q: string
  categoryId: string
  type: ProductType | ''
  /** Counted or uncounted. Empty means both. */
  tracked: 'true' | 'false' | ''
  includeInactive: boolean
  sort: ProductSort
  page: number
  pageSize: number
}

export const EMPTY_PRODUCT_FILTERS: ProductFilters = {
  q: '',
  categoryId: '',
  type: '',
  tracked: '',
  includeInactive: false,
  sort: DEFAULT_PRODUCT_SORT,
  page: 1,
  pageSize: 25,
}

export function countActiveProductFilters(filters: ProductFilters): number {
  return [
    filters.q,
    filters.categoryId,
    filters.type,
    filters.tracked,
    filters.includeInactive ? 'yes' : '',
  ].filter((value) => value !== '').length
}

export interface ProductPage {
  items: ProductRow[]
  meta: PageMeta | undefined
}

export async function listProducts(filters: ProductFilters): Promise<ProductPage> {
  // The API client drops empty strings, so an unset filter is simply not sent, and the server's
  // own default applies instead of a value this screen invented.
  const response = await apiRequestCollection<ProductRow>('/products', {
    query: {
      q: filters.q,
      categoryId: filters.categoryId,
      type: filters.type,
      tracked: filters.tracked,
      includeInactive: filters.includeInactive ? 'true' : 'false',
      sort: filters.sort,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  })
  return { items: response.items, meta: response.meta }
}

export function fetchProduct(id: string): Promise<ProductRow> {
  return apiRequest<ProductRow>(`/products/${id}`)
}

export interface ProductInput {
  /** Left out to be generated from the name, because most cooperatives have no codes yet. */
  sku?: string
  name: string
  nameRw?: string
  categoryId?: string
  unitId: string
  type: ProductType
  trackInventory: boolean
  minStockLevel?: string
  defaultPurchasePrice?: string
  defaultSalePrice?: string
  description?: string
}

export function createProduct(input: ProductInput): Promise<ProductRow> {
  return apiRequest<ProductRow>('/products', { method: 'POST', body: input })
}

/**
 * Everything a product can still change.
 *
 * `unitId` and `trackInventory` are present because a product with no history can still change
 * both, and absent from the form once `hasMovements` is true: changing the unit would restate
 * every quantity already recorded — three hundred kilograms becoming three hundred tonnes — and
 * making a counted product uncounted would abandon its stock level with no movement to say where
 * it went. The server refuses both, and the form does not offer them.
 *
 * `type` cannot change at all: a product is goods or a service for good.
 */
export interface UpdateProductInput {
  sku?: string
  name?: string
  nameRw?: string | null
  categoryId?: string | null
  unitId?: string
  trackInventory?: boolean
  minStockLevel?: string | null
  defaultPurchasePrice?: string | null
  defaultSalePrice?: string | null
  description?: string | null
  isActive?: boolean
}

export function updateProduct(id: string, changes: UpdateProductInput): Promise<ProductRow> {
  return apiRequest<ProductRow>(`/products/${id}`, { method: 'PATCH', body: changes })
}

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

export interface WarehouseRow {
  id: string
  name: string
  code: string
  district: string | null
  sector: string | null
  isDefault: boolean
  isActive: boolean
  /** How many products are sitting in it, so a store is never closed unknowingly. */
  productsHeld: number
  quantityHeld: string
}

export function listWarehouses(includeInactive: boolean): Promise<WarehouseRow[]> {
  return apiRequest<WarehouseRow[]>('/warehouses', {
    query: { includeInactive: includeInactive ? 'true' : 'false' },
  })
}

export interface WarehouseInput {
  name: string
  code?: string
  district?: string
  sector?: string
  /**
   * Making this the default moves the flag off whichever store held it. The first store a
   * cooperative creates is its default whatever was asked for, because stock has to arrive
   * somewhere.
   */
  isDefault: boolean
}

export function createWarehouse(input: WarehouseInput): Promise<WarehouseRow> {
  return apiRequest<WarehouseRow>('/warehouses', { method: 'POST', body: input })
}

export interface UpdateWarehouseInput {
  name?: string
  code?: string
  district?: string | null
  sector?: string | null
  isDefault?: boolean
  isActive?: boolean
}

export function updateWarehouse(id: string, changes: UpdateWarehouseInput): Promise<WarehouseRow> {
  return apiRequest<WarehouseRow>(`/warehouses/${id}`, { method: 'PATCH', body: changes })
}

// ---------------------------------------------------------------------------
// Stock levels
// ---------------------------------------------------------------------------

export const STOCK_SORTS = ['product', '-product', 'quantity', '-quantity'] as const
export type StockSort = (typeof STOCK_SORTS)[number]

export const DEFAULT_STOCK_SORT: StockSort = 'product'

export interface StockRow {
  productId: string
  sku: string
  productName: string
  productNameRw: string | null
  categoryName: string | null
  unitSymbol: string
  warehouseId: string
  warehouseName: string
  quantity: string
  minStockLevel: string | null
  /** True when the level is at or below the minimum somebody asked to be warned about. */
  isLow: boolean
}

export interface StockFilters {
  q: string
  warehouseId: string
  categoryId: string
  lowOnly: boolean
  inStockOnly: boolean
  sort: StockSort
  page: number
  pageSize: number
}

export const EMPTY_STOCK_FILTERS: StockFilters = {
  q: '',
  warehouseId: '',
  categoryId: '',
  lowOnly: false,
  inStockOnly: false,
  sort: DEFAULT_STOCK_SORT,
  page: 1,
  pageSize: 25,
}

export function countActiveStockFilters(filters: StockFilters): number {
  return [
    filters.q,
    filters.warehouseId,
    filters.categoryId,
    filters.lowOnly ? 'yes' : '',
    filters.inStockOnly ? 'yes' : '',
  ].filter((value) => value !== '').length
}

export interface StockPage {
  items: StockRow[]
  meta: PageMeta | undefined
  /**
   * How many products are at or below their minimum across the **whole catalogue**, not on the
   * page being read. That is the figure the overview leads with, and it is the reason a filtered
   * view can still say how much needs attention elsewhere.
   */
  lowCount: number
}

/**
 * Reads `meta.lowCount` without asserting it into existence.
 *
 * The collection helper types its metadata as `PageMeta`, the shape every list endpoint shares;
 * this endpoint adds one figure on top. Rather than casting the metadata into a wider type and
 * hoping, the field is checked and a missing or malformed value falls back to nothing, so a
 * server that stops sending it shows no warning rather than crashing the screen.
 */
function readLowCount(meta: PageMeta | undefined): number {
  if (meta === undefined || !('lowCount' in meta)) return 0
  const { lowCount } = meta
  return typeof lowCount === 'number' && Number.isFinite(lowCount) ? lowCount : 0
}

function stockQuery(filters: StockFilters): Record<string, string | number> {
  return {
    q: filters.q,
    warehouseId: filters.warehouseId,
    categoryId: filters.categoryId,
    // Only sent when asked for. The server defaults both to false, so an empty value means the
    // same thing and keeps a shared link short.
    lowOnly: filters.lowOnly ? 'true' : '',
    inStockOnly: filters.inStockOnly ? 'true' : '',
    sort: filters.sort,
    page: filters.page,
    pageSize: filters.pageSize,
  }
}

export async function listStock(filters: StockFilters): Promise<StockPage> {
  const response = await apiRequestCollection<StockRow>('/inventory/stock', {
    query: stockQuery(filters),
  })
  return { items: response.items, meta: response.meta, lowCount: readLowCount(response.meta) }
}

/** The same list, already narrowed by the server to what needs attention. */
export async function listLowStock(filters: StockFilters): Promise<StockPage> {
  const response = await apiRequestCollection<StockRow>('/inventory/low-stock', {
    query: stockQuery({ ...filters, lowOnly: true }),
  })
  return { items: response.items, meta: response.meta, lowCount: readLowCount(response.meta) }
}

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

export const MOVEMENT_TYPES = [
  'RECEIPT',
  'ISSUE',
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'SALE_OUT',
  'SALE_RETURN',
  'OPENING',
] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

export const DIRECTIONS = ['IN', 'OUT'] as const
export type Direction = (typeof DIRECTIONS)[number]

export const MOVEMENT_SORTS = ['occurredAt', '-occurredAt', 'reference', '-reference'] as const
export type MovementSort = (typeof MOVEMENT_SORTS)[number]

export const DEFAULT_MOVEMENT_SORT: MovementSort = '-occurredAt'

export interface MovementRow {
  id: string
  reference: string
  type: MovementType
  direction: Direction
  productId: string
  productName: string
  sku: string
  unitSymbol: string
  warehouseId: string
  warehouseName: string
  quantity: string
  unitCost: string | null
  totalCost: string | null
  memberId: string | null
  memberName: string | null
  reason: string | null
  note: string | null
  occurredAt: string
  /** Set when this movement is itself a correction, naming the movement it corrects. */
  reversalOfReference: string | null
  /** Set when this movement has been corrected, naming the correction. */
  reversedByReference: string | null
  /** The other half of a transfer, so the history can say where the stock went. */
  counterpartyReference: string | null
  /** The ledger entry this movement created, where the cooperative paid on receipt. */
  financeReference: string | null
}

export interface MovementFilters {
  q: string
  productId: string
  warehouseId: string
  memberId: string
  type: MovementType | ''
  direction: Direction | ''
  from: string
  to: string
  sort: MovementSort
  page: number
  pageSize: number
}

export const EMPTY_MOVEMENT_FILTERS: MovementFilters = {
  q: '',
  productId: '',
  warehouseId: '',
  memberId: '',
  type: '',
  direction: '',
  from: '',
  to: '',
  sort: DEFAULT_MOVEMENT_SORT,
  page: 1,
  pageSize: 25,
}

export function countActiveMovementFilters(filters: MovementFilters): number {
  return [
    filters.q,
    filters.productId,
    filters.warehouseId,
    filters.memberId,
    filters.type,
    filters.direction,
    filters.from,
    filters.to,
  ].filter((value) => value !== '').length
}

/** The quantity that went in and the quantity that came out, over the whole filtered set. */
export interface MovementTotals {
  in: string
  out: string
}

export const ZERO_MOVEMENT_TOTALS: MovementTotals = { in: '0.000', out: '0.000' }

export interface MovementsPage {
  items: MovementRow[]
  meta: PageMeta | undefined
  totals: MovementTotals
}

/** Read one field at a time for the reason given on `readLowCount`. */
function readMovementTotals(meta: PageMeta | undefined): MovementTotals {
  if (meta === undefined || !('totals' in meta)) return ZERO_MOVEMENT_TOTALS
  const { totals } = meta
  if (typeof totals !== 'object' || totals === null) return ZERO_MOVEMENT_TOTALS
  if (!('in' in totals) || !('out' in totals)) return ZERO_MOVEMENT_TOTALS
  const { in: inward, out: outward } = totals
  if (typeof inward !== 'string' || typeof outward !== 'string') return ZERO_MOVEMENT_TOTALS
  return { in: inward, out: outward }
}

export async function listMovements(filters: MovementFilters): Promise<MovementsPage> {
  const response = await apiRequestCollection<MovementRow>('/inventory/transactions', {
    query: {
      q: filters.q,
      productId: filters.productId,
      warehouseId: filters.warehouseId,
      memberId: filters.memberId,
      type: filters.type,
      direction: filters.direction,
      from: filters.from,
      to: filters.to,
      sort: filters.sort,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  })
  return {
    items: response.items,
    meta: response.meta,
    totals: readMovementTotals(response.meta),
  }
}

// ---------------------------------------------------------------------------
// The four movements
// ---------------------------------------------------------------------------

export interface MovementResult {
  id: string
  reference: string
  type: MovementType
  direction: Direction
  quantity: string
  /** The level in that store after the movement, which is what the screen reports back. */
  quantityAfter: string
  financeReference: string | null
}

export interface ReceiveInput {
  productId: string
  warehouseId: string
  /** A decimal string, exactly as it was typed. Never a JavaScript number. */
  quantity: string
  unitCost?: string
  /** The member who delivered it. There is no separate deliveries record to disagree with. */
  sourceMemberId?: string
  occurredAt?: string
  note?: string
  /**
   * Posts the cost to this expense category inside the same transaction, so the store record and
   * the books cannot end up describing different money. The server requires `unitCost` alongside
   * it, and the form asks for one rather than sending a receipt it knows will be refused.
   */
  expenseCategoryId?: string
  /** How the cooperative paid, where it did. Only meaningful alongside an expense category. */
  method?: PaymentMethod
}

export function receiveStock(input: ReceiveInput): Promise<MovementResult> {
  return apiRequest<MovementResult>('/inventory/receive', {
    method: 'POST',
    body: input,
    idempotencyKey: newIdempotencyKey(),
  })
}

export interface IssueInput {
  productId: string
  warehouseId: string
  quantity: string
  occurredAt?: string
  reason?: string
  note?: string
}

export function issueStock(input: IssueInput): Promise<MovementResult> {
  return apiRequest<MovementResult>('/inventory/issue', {
    method: 'POST',
    body: input,
    idempotencyKey: newIdempotencyKey(),
  })
}

export interface AdjustInput {
  productId: string
  warehouseId: string
  /** What was counted, not the difference. The server works out the sign. May be "0". */
  countedQuantity: string
  /** Required. An unexplained correction is what makes a shortfall unauditable. */
  reason: string
  occurredAt?: string
  note?: string
}

export function adjustStock(input: AdjustInput): Promise<MovementResult> {
  return apiRequest<MovementResult>('/inventory/adjust', {
    method: 'POST',
    body: input,
    idempotencyKey: newIdempotencyKey(),
  })
}

export interface TransferInput {
  productId: string
  fromWarehouseId: string
  toWarehouseId: string
  quantity: string
  occurredAt?: string
  note?: string
}

/** Two rows, each naming the other, written in one transaction. */
export interface TransferResult {
  out: MovementResult
  in: MovementResult
}

export function transferStock(input: TransferInput): Promise<TransferResult> {
  return apiRequest<TransferResult>('/inventory/transfer', {
    method: 'POST',
    body: input,
    idempotencyKey: newIdempotencyKey(),
  })
}

/**
 * Corrects a movement by writing its opposite.
 *
 * Two entries come back when the movement was half of a transfer, because undoing one half alone
 * would leave stock recorded in a store it never reached.
 */
export interface ReversalResult {
  reversals: MovementResult[]
}

export function reverseMovement(id: string, reason: string): Promise<ReversalResult> {
  return apiRequest<ReversalResult>(`/inventory/transactions/${id}/reverse`, {
    method: 'POST',
    body: { reason },
    idempotencyKey: newIdempotencyKey(),
  })
}

// ---------------------------------------------------------------------------
// Valuation
// ---------------------------------------------------------------------------

export interface ValuationRow {
  productId: string
  sku: string
  productName: string
  unitSymbol: string
  quantity: string
  /** The weighted average of what the cooperative actually paid, where it has ever paid. */
  unitCost: string | null
  value: string
  /** True when the figure rests on a list price rather than on a receipt. */
  costIsEstimated: boolean
}

export interface Valuation {
  rows: ValuationRow[]
  total: string
  /** How many rows rest on an estimate, which the screen has to say out loud. */
  estimatedCount: number
}

/**
 * What the stock is worth. Needs `inventory:view` **and** `finance:view`: a storekeeper who may
 * count sacks is not thereby entitled to know what the cooperative paid for them.
 */
export function fetchValuation(): Promise<Valuation> {
  return apiRequest<Valuation>('/inventory/valuation')
}

// ---------------------------------------------------------------------------
// What a field may hold
// ---------------------------------------------------------------------------

/**
 * A quantity: up to eleven whole digits and at most three decimal places, which is exactly what
 * `numeric(14,3)` holds. Checked as characters rather than by parsing, because parsing is the
 * step that loses the gram.
 */
export const QUANTITY_PATTERN = /^\d{1,11}(\.\d{1,3})?$/

/** Money: up to twelve whole digits and at most two decimal places. */
export const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/

export function isQuantity(value: string): boolean {
  return QUANTITY_PATTERN.test(value.trim())
}

/**
 * A quantity greater than nothing. Receiving, issuing and transferring nothing is not a movement,
 * so those three ask for this; a count of zero is a real count, so the correction does not.
 */
export function isPositiveQuantity(value: string): boolean {
  const trimmed = value.trim()
  return QUANTITY_PATTERN.test(trimmed) && /[1-9]/.test(trimmed)
}

export function isMoney(value: string): boolean {
  return MONEY_PATTERN.test(value.trim())
}

/**
 * Just enough of a product and a store to open a movement dialog with both already chosen.
 *
 * A row's own action passes this so the storekeeper does not have to find in a picker the product
 * they were already looking at. It carries the unit symbol as well, because the quantity field
 * has to be able to say what it is asking for before anything else is fetched.
 */
export interface MovementPreset {
  productId: string
  productName: string
  sku: string
  unitSymbol: string
  warehouseId: string
}

export function presetFromStockRow(row: StockRow): MovementPreset {
  return {
    productId: row.productId,
    productName: row.productName,
    sku: row.sku,
    unitSymbol: row.unitSymbol,
    warehouseId: row.warehouseId,
  }
}

export function presetFromProduct(row: ProductRow, warehouseId: string): MovementPreset {
  return {
    productId: row.id,
    productName: row.name,
    sku: row.sku,
    unitSymbol: row.unitSymbol,
    warehouseId,
  }
}
