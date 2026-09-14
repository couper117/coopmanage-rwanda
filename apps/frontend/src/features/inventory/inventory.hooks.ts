import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
// `useDebouncedValue` is pure state and carries no finance meaning; it is imported rather than
// copied so a search field behaves the same way in both features.
import { financeKeys, useDebouncedValue } from '@/features/finance/finance.hooks'
import { useApiError, type DisplayableError } from '@/hooks/useApiErrorMessage'
import { ApiError } from '@/lib/apiClient'
import { useAuthStore } from '@/stores/authStore'
import {
  adjustStock,
  createProduct,
  createProductCategory,
  createUnit,
  createWarehouse,
  DEFAULT_MOVEMENT_SORT,
  DEFAULT_PRODUCT_SORT,
  DEFAULT_STOCK_SORT,
  DIRECTIONS,
  EMPTY_MOVEMENT_FILTERS,
  EMPTY_PRODUCT_FILTERS,
  EMPTY_STOCK_FILTERS,
  fetchValuation,
  issueStock,
  listLowStock,
  listMovements,
  listProductCategories,
  listProducts,
  listStock,
  listUnits,
  listWarehouses,
  MOVEMENT_SORTS,
  MOVEMENT_TYPES,
  PRODUCT_SORTS,
  PRODUCT_TYPES,
  receiveStock,
  reverseMovement,
  STOCK_SORTS,
  transferStock,
  updateProduct,
  updateProductCategory,
  updateUnit,
  updateWarehouse,
  type AdjustInput,
  type Direction,
  type IssueInput,
  type MovementFilters,
  type MovementSort,
  type MovementType,
  type ProductCategoryInput,
  type ProductFilters,
  type ProductInput,
  type ProductSort,
  type ProductType,
  type ReceiveInput,
  type StockFilters,
  type StockRow,
  type StockSort,
  type TransferInput,
  type UnitInput,
  type UpdateProductCategoryInput,
  type UpdateProductInput,
  type UpdateUnitInput,
  type UpdateWarehouseInput,
  type WarehouseInput,
} from './inventory.api'

export { useDebouncedValue }

/**
 * Server state for the cooperative's store.
 *
 * Every key is namespaced under `inventory` and carries the cooperative it belongs to, so
 * switching tenant can never show the previous cooperative's stock from cache. Mutations
 * invalidate the whole namespace rather than patching a row: receiving one delivery changes the
 * level, the low-stock count, the movement history, the valuation, the store's total and the
 * product's quantity on hand at once, and refetching is both simpler and more truthful than
 * reconciling six views by hand.
 */
export const inventoryKeys = {
  all: ['inventory'] as const,
  scope: (cooperativeId: string | null) => ['inventory', cooperativeId] as const,
  stock: (cooperativeId: string | null, filters: StockFilters) =>
    ['inventory', cooperativeId, 'stock', filters] as const,
  lowStock: (cooperativeId: string | null, filters: StockFilters) =>
    ['inventory', cooperativeId, 'lowStock', filters] as const,
  movements: (cooperativeId: string | null, filters: MovementFilters) =>
    ['inventory', cooperativeId, 'movements', filters] as const,
  valuation: (cooperativeId: string | null) => ['inventory', cooperativeId, 'valuation'] as const,
  products: (cooperativeId: string | null, filters: ProductFilters) =>
    ['inventory', cooperativeId, 'products', filters] as const,
  productLookup: (cooperativeId: string | null, query: string, countedOnly: boolean) =>
    ['inventory', cooperativeId, 'productLookup', query, countedOnly] as const,
  warehouses: (cooperativeId: string | null, includeInactive: boolean) =>
    ['inventory', cooperativeId, 'warehouses', includeInactive] as const,
  units: (cooperativeId: string | null, includeInactive: boolean) =>
    ['inventory', cooperativeId, 'units', includeInactive] as const,
  categories: (cooperativeId: string | null, includeInactive: boolean) =>
    ['inventory', cooperativeId, 'categories', includeInactive] as const,
}

function useCooperativeId(): string | null {
  return useAuthStore((state) => state.activeCooperativeId)
}

/**
 * Refusals that are particular to the store, mapped to sentences that say what to do about them.
 * The shared hook translates everything else.
 *
 * Two of these matter more than the rest. `insufficientStock` deliberately quotes no figure,
 * because the server does not send one: by the time the refusal is read the level may have moved
 * again, and a stale number is worse than none. `unitFrozen` and `countingFrozen` are a backstop
 * rather than the explanation — the product form disables both controls and says why, so this
 * message should only ever be seen by somebody who got there another way.
 */
const INVENTORY_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  'errors.inventory.insufficientStock': 'apiErrors.insufficientStock',
  'errors.inventory.countAgrees': 'apiErrors.countAgrees',
  'errors.inventory.alreadyReversed': 'apiErrors.alreadyReversed',
  'errors.inventory.isAReversal': 'apiErrors.isAReversal',
  'errors.inventory.productRetired': 'apiErrors.productRetired',
  'errors.inventory.productNotCounted': 'apiErrors.productNotCounted',
  'errors.inventory.warehouseClosed': 'apiErrors.warehouseClosed',
  'errors.catalogue.systemUnit': 'apiErrors.systemUnit',
  'errors.catalogue.unitKeyTaken': 'apiErrors.unitKeyTaken',
  'errors.catalogue.unitFrozen': 'apiErrors.unitFrozen',
  'errors.catalogue.countingFrozen': 'apiErrors.countingFrozen',
  'errors.catalogue.skuTaken': 'apiErrors.skuTaken',
  'errors.catalogue.categoryTooDeep': 'apiErrors.categoryTooDeep',
  'errors.catalogue.categoryNameTaken': 'apiErrors.categoryNameTaken',
  'errors.catalogue.warehouseIsDefault': 'apiErrors.warehouseIsDefault',
  'errors.catalogue.warehouseHoldsStock': 'apiErrors.warehouseHoldsStock',
  'errors.catalogue.warehouseCodeTaken': 'apiErrors.warehouseCodeTaken',
}

export function useInventoryError(): (error: unknown) => DisplayableError {
  const describeError = useApiError()
  const { t } = useTranslation('inventory')

  return useCallback(
    (error: unknown): DisplayableError => {
      const described = describeError(error)
      if (!(error instanceof ApiError)) return described
      const key = INVENTORY_MESSAGE_KEYS[error.messageKey]
      if (!key) return described
      return { ...described, message: t(key, { ...error.messageParams }) }
    },
    [describeError, t],
  )
}

/**
 * True for the one refusal a screen has to react to rather than merely report.
 *
 * The server does not say how much stock there is, on purpose. So the screen that gets this
 * reloads the level and shows what is there now, instead of quoting back a figure that was
 * already out of date when the request was sent.
 */
export function isInsufficientStock(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'INSUFFICIENT_STOCK'
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Dates on the stock screens.
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
  const { i18n } = useTranslation('inventory')
  const locale = intlLocale(i18n.resolvedLanguage)
  return useCallback(
    (value: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parseApiDate(value)),
    [locale],
  )
}

export function useFormatNumber(): (value: number) => string {
  const { i18n } = useTranslation('inventory')
  const locale = intlLocale(i18n.resolvedLanguage)
  return useCallback((value: number) => new Intl.NumberFormat(locale).format(value), [locale])
}

/**
 * Which of a product's two names to show.
 *
 * A cooperative may only have filled in one of them, so a missing Kinyarwanda name falls back to
 * the English one rather than leaving a blank cell where the reader expects a product.
 */
export function useProductLabel(): (product: { name: string; nameRw: string | null }) => string {
  const { i18n } = useTranslation('inventory')
  const preferRw = i18n.resolvedLanguage === 'rw'
  return useCallback(
    (product: { name: string; nameRw: string | null }) =>
      preferRw ? (product.nameRw ?? product.name) : product.name,
    [preferRw],
  )
}

/** The same choice for a unit, whose two names are both required by the server. */
export function useUnitLabel(): (unit: { nameEn: string; nameRw: string }) => string {
  const { i18n } = useTranslation('inventory')
  const preferRw = i18n.resolvedLanguage === 'rw'
  return useCallback(
    (unit: { nameEn: string; nameRw: string }) => (preferRw ? unit.nameRw : unit.nameEn),
    [preferRw],
  )
}

/** Today, as the server writes dates, for a form default. */
export function todayIso(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
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

export function readStockFiltersFromParams(params: URLSearchParams): StockFilters {
  return {
    q: params.get('q') ?? '',
    warehouseId: params.get('warehouseId') ?? '',
    categoryId: params.get('categoryId') ?? '',
    lowOnly: readFlag(params.get('lowOnly')),
    inStockOnly: readFlag(params.get('inStockOnly')),
    sort: oneOf<StockSort>(STOCK_SORTS, params.get('sort')) || DEFAULT_STOCK_SORT,
    page: readPage(params.get('page')),
    pageSize: EMPTY_STOCK_FILTERS.pageSize,
  }
}

/** Only what differs from the default is written, so a shared link stays readable. */
function writeStockFiltersToParams(filters: StockFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.warehouseId) params.set('warehouseId', filters.warehouseId)
  if (filters.categoryId) params.set('categoryId', filters.categoryId)
  if (filters.lowOnly) params.set('lowOnly', 'true')
  if (filters.inStockOnly) params.set('inStockOnly', 'true')
  if (filters.sort !== DEFAULT_STOCK_SORT) params.set('sort', filters.sort)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

export function readMovementFiltersFromParams(params: URLSearchParams): MovementFilters {
  return {
    q: params.get('q') ?? '',
    productId: params.get('productId') ?? '',
    warehouseId: params.get('warehouseId') ?? '',
    memberId: params.get('memberId') ?? '',
    type: oneOf<MovementType>(MOVEMENT_TYPES, params.get('type')),
    direction: oneOf<Direction>(DIRECTIONS, params.get('direction')),
    from: readDate(params.get('from')),
    to: readDate(params.get('to')),
    sort: oneOf<MovementSort>(MOVEMENT_SORTS, params.get('sort')) || DEFAULT_MOVEMENT_SORT,
    page: readPage(params.get('page')),
    pageSize: EMPTY_MOVEMENT_FILTERS.pageSize,
  }
}

function writeMovementFiltersToParams(filters: MovementFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.productId) params.set('productId', filters.productId)
  if (filters.warehouseId) params.set('warehouseId', filters.warehouseId)
  if (filters.memberId) params.set('memberId', filters.memberId)
  if (filters.type) params.set('type', filters.type)
  if (filters.direction) params.set('direction', filters.direction)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.sort !== DEFAULT_MOVEMENT_SORT) params.set('sort', filters.sort)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

export function readProductFiltersFromParams(params: URLSearchParams): ProductFilters {
  const tracked = params.get('tracked')
  return {
    q: params.get('q') ?? '',
    categoryId: params.get('categoryId') ?? '',
    type: oneOf<ProductType>(PRODUCT_TYPES, params.get('type')),
    tracked: tracked === 'true' ? 'true' : tracked === 'false' ? 'false' : '',
    includeInactive: readFlag(params.get('includeInactive')),
    sort: oneOf<ProductSort>(PRODUCT_SORTS, params.get('sort')) || DEFAULT_PRODUCT_SORT,
    page: readPage(params.get('page')),
    pageSize: EMPTY_PRODUCT_FILTERS.pageSize,
  }
}

function writeProductFiltersToParams(filters: ProductFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.categoryId) params.set('categoryId', filters.categoryId)
  if (filters.type) params.set('type', filters.type)
  if (filters.tracked) params.set('tracked', filters.tracked)
  if (filters.includeInactive) params.set('includeInactive', 'true')
  if (filters.sort !== DEFAULT_PRODUCT_SORT) params.set('sort', filters.sort)
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
 * Builds one of the three filter hooks below.
 *
 * The filters live in the URL rather than in component state, so a view narrowed to one store and
 * one category can be bookmarked, sent to the manager, and reached again by the back button. The
 * three sets differ only in what they read and write, so the paging and history behaviour is
 * defined once here rather than three times: any change to a filter returns to the first page,
 * because staying on page four of a narrower result is how a reader ends up looking at an empty
 * table and concluding there is nothing there.
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
      // `read` and `write` come from the factory's closure rather than from a render, so they
      // are outer-scope values and not reactive dependencies.
      [setParams],
    )

    const clear = useCallback(() => {
      setParams(new URLSearchParams(), { replace: true })
    }, [setParams])

    return { filters: read(params), patch, clear }
  }
}

export const useStockFilters = makeFilterHook(readStockFiltersFromParams, writeStockFiltersToParams)

export const useMovementFilters = makeFilterHook(
  readMovementFiltersFromParams,
  writeMovementFiltersToParams,
)

export const useProductFilters = makeFilterHook(
  readProductFiltersFromParams,
  writeProductFiltersToParams,
)

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function useStockList(filters: StockFilters) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: inventoryKeys.stock(cooperativeId, filters),
    queryFn: () => listStock(filters),
    enabled: cooperativeId !== null,
  })
}

/**
 * What needs attention, asked for separately from the table below it.
 *
 * The overview could filter its own list, but then narrowing the table to one store would also
 * narrow the warning, and a storekeeper looking at one store would stop being told that something
 * is running out in another.
 */
export function useLowStockList(pageSize = 5) {
  const cooperativeId = useCooperativeId()
  const filters: StockFilters = {
    ...EMPTY_STOCK_FILTERS,
    lowOnly: true,
    sort: 'quantity',
    pageSize,
  }
  return useQuery({
    queryKey: inventoryKeys.lowStock(cooperativeId, filters),
    queryFn: () => listLowStock(filters),
    enabled: cooperativeId !== null,
  })
}

/**
 * The level of one product in one store.
 *
 * Three of the four movement dialogs need this. The issue dialog needs it because the server's
 * refusal deliberately does not say how much there is — by the time a refusal is read the level
 * may have moved again, so the screen re-reads it and reports what is recorded now rather than
 * quoting a figure back. The correction dialog needs it because a storekeeper types what they
 * counted and the screen has to be able to say what the record claims. The transfer dialog needs
 * it for the store the stock is leaving.
 *
 * The search is by code rather than by identifier because that is what the stock endpoint
 * accepts, so the matching row is picked out here rather than trusted to be the only one.
 */
export function useStockLevel(
  input: { productId: string; sku: string; warehouseId: string } | null,
  enabled: boolean,
) {
  const cooperativeId = useCooperativeId()
  const filters: StockFilters = {
    ...EMPTY_STOCK_FILTERS,
    q: input?.sku ?? '',
    warehouseId: input?.warehouseId ?? '',
    pageSize: 10,
  }
  return useQuery({
    queryKey: inventoryKeys.stock(cooperativeId, filters),
    queryFn: () => listStock(filters),
    enabled: enabled && input !== null && input.warehouseId !== '' && cooperativeId !== null,
  })
}

/** Picks the one row of a level read that concerns this product, or nothing. */
export function levelOf(
  page: { items: StockRow[] } | undefined,
  productId: string,
): StockRow | null {
  return page?.items.find((row) => row.productId === productId) ?? null
}

export function useMovementsList(filters: MovementFilters) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: inventoryKeys.movements(cooperativeId, filters),
    queryFn: () => listMovements(filters),
    enabled: cooperativeId !== null,
  })
}

/**
 * What the stock is worth. `enabled` carries the caller's own condition, which is whether the
 * reader holds `finance:view` as well: without it the request would be refused, and asking would
 * only put a failure on a screen the reader is otherwise entitled to.
 */
export function useValuation(enabled: boolean) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: inventoryKeys.valuation(cooperativeId),
    queryFn: () => fetchValuation(),
    enabled: enabled && cooperativeId !== null,
  })
}

export function useProductsList(filters: ProductFilters) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: inventoryKeys.products(cooperativeId, filters),
    queryFn: () => listProducts(filters),
    enabled: cooperativeId !== null,
  })
}

/**
 * The picker over the catalogue, which is too long for a dropdown once a cooperative has been
 * trading a season.
 *
 * `countedOnly` narrows it to the products a movement can name at all: a service has no stock, so
 * offering one in the receive dialog would only produce a refusal.
 */
export function useProductLookup(query: string, enabled: boolean, countedOnly = true) {
  const cooperativeId = useCooperativeId()
  const debounced = useDebouncedValue(query.trim(), 250)

  return useQuery({
    queryKey: inventoryKeys.productLookup(cooperativeId, debounced, countedOnly),
    queryFn: () =>
      listProducts({
        ...EMPTY_PRODUCT_FILTERS,
        q: debounced,
        ...(countedOnly ? { tracked: 'true' as const } : {}),
        pageSize: 10,
      }),
    enabled: enabled && cooperativeId !== null,
    // The previous ten stay on screen while the next ten are fetched, so the list does not blink
    // empty between keystrokes and offer "nothing found" to somebody mid-word.
    placeholderData: keepPreviousData,
  })
}

export function useWarehouses(options: { includeInactive?: boolean; enabled?: boolean } = {}) {
  const cooperativeId = useCooperativeId()
  const includeInactive = options.includeInactive === true
  return useQuery({
    queryKey: inventoryKeys.warehouses(cooperativeId, includeInactive),
    queryFn: () => listWarehouses(includeInactive),
    enabled: options.enabled !== false && cooperativeId !== null,
    staleTime: 5 * 60_000,
  })
}

export function useUnits(options: { includeInactive?: boolean; enabled?: boolean } = {}) {
  const cooperativeId = useCooperativeId()
  const includeInactive = options.includeInactive === true
  return useQuery({
    queryKey: inventoryKeys.units(cooperativeId, includeInactive),
    queryFn: () => listUnits(includeInactive),
    enabled: options.enabled !== false && cooperativeId !== null,
    staleTime: 5 * 60_000,
  })
}

export function useProductCategories(
  options: { includeInactive?: boolean; enabled?: boolean } = {},
) {
  const cooperativeId = useCooperativeId()
  const includeInactive = options.includeInactive === true
  return useQuery({
    queryKey: inventoryKeys.categories(cooperativeId, includeInactive),
    queryFn: () => listProductCategories(includeInactive),
    enabled: options.enabled !== false && cooperativeId !== null,
    staleTime: 5 * 60_000,
  })
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * One invalidation for the whole feature, for the reason given on `inventoryKeys`.
 *
 * The books are invalidated alongside the store, because a receipt given an expense category
 * posts a ledger entry in the same transaction. Leaving finance alone would let a treasurer sit
 * in front of a balance that no longer includes money the cooperative has just spent.
 */
function useInventoryMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const cooperativeId = useCooperativeId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: inventoryKeys.scope(cooperativeId) })
      await queryClient.invalidateQueries({ queryKey: financeKeys.scope(cooperativeId) })
    },
  })
}

/**
 * The four movements.
 *
 * Each sends a retry key generated per attempt inside `inventory.api.ts`, so a storekeeper on a
 * slow connection who presses Receive twice records one delivery rather than two. Per attempt
 * rather than per dialog opening is the conservative choice: somebody who corrects a refused
 * quantity and submits again is recording something genuinely different, and must not be handed
 * the first attempt's stored response.
 */
export function useReceiveStock() {
  return useInventoryMutation((input: ReceiveInput) => receiveStock(input))
}

export function useIssueStock() {
  return useInventoryMutation((input: IssueInput) => issueStock(input))
}

export function useAdjustStock() {
  return useInventoryMutation((input: AdjustInput) => adjustStock(input))
}

export function useTransferStock() {
  return useInventoryMutation((input: TransferInput) => transferStock(input))
}

export function useReverseMovement() {
  return useInventoryMutation((input: { id: string; reason: string }) =>
    reverseMovement(input.id, input.reason),
  )
}

export function useCreateProduct() {
  return useInventoryMutation((input: ProductInput) => createProduct(input))
}

export function useUpdateProduct() {
  return useInventoryMutation((input: { id: string; changes: UpdateProductInput }) =>
    updateProduct(input.id, input.changes),
  )
}

export function useCreateWarehouse() {
  return useInventoryMutation((input: WarehouseInput) => createWarehouse(input))
}

export function useUpdateWarehouse() {
  return useInventoryMutation((input: { id: string; changes: UpdateWarehouseInput }) =>
    updateWarehouse(input.id, input.changes),
  )
}

export function useCreateUnit() {
  return useInventoryMutation((input: UnitInput) => createUnit(input))
}

export function useUpdateUnit() {
  return useInventoryMutation((input: { id: string; changes: UpdateUnitInput }) =>
    updateUnit(input.id, input.changes),
  )
}

export function useCreateProductCategory() {
  return useInventoryMutation((input: ProductCategoryInput) => createProductCategory(input))
}

export function useUpdateProductCategory() {
  return useInventoryMutation((input: { id: string; changes: UpdateProductCategoryInput }) =>
    updateProductCategory(input.id, input.changes),
  )
}
