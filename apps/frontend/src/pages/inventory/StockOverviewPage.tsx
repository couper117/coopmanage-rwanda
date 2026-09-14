import {
  ArrowRight,
  ArrowLeftRight,
  ClipboardCheck,
  PackageMinus,
  PackagePlus,
  PackageSearch,
  SearchX,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
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
  Select,
  Switch,
  type Column,
  type SelectOption,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { AdjustStockDialog } from '@/features/inventory/AdjustStockDialog'
import { IssueStockDialog } from '@/features/inventory/IssueStockDialog'
import { ReceiveStockDialog } from '@/features/inventory/ReceiveStockDialog'
import { TransferStockDialog } from '@/features/inventory/TransferStockDialog'
import {
  countActiveStockFilters,
  presetFromStockRow,
  STOCK_SORTS,
  type MovementPreset,
  type StockRow,
  type StockSort,
} from '@/features/inventory/inventory.api'
import {
  useDebouncedValue,
  useFormatNumber,
  useInventoryError,
  useLowStockList,
  useProductCategories,
  useProductLabel,
  useStockFilters,
  useStockList,
  useValuation,
  useWarehouses,
} from '@/features/inventory/inventory.hooks'

/**
 * What is in the store, and what is about to run out.
 *
 * The screen answers those two questions in that order, because the second is the one that costs
 * a cooperative money. So what needs attention comes first — the number of products at or below
 * their minimum, taken from the metadata and therefore counted across the whole catalogue rather
 * than over the page on screen, and then those rows themselves — and the full stock table comes
 * after it.
 *
 * **The four movements are dialogs over this table, not separate screens.** A storekeeper works
 * down a list, and being sent to another page and back again loses their place in it. Each dialog
 * is behind its own permission, and a row's own action opens the dialog with that product and
 * that store already chosen, so the common case takes one click and no searching.
 *
 * **Every quantity on this screen is the string the server sent.** `Quantity` renders it from its
 * characters; nothing here parses a quantity into a number, adds two of them together, or works
 * out a difference. The only arithmetic is over row counts, which are integers by nature.
 *
 * Every control is hidden when the permission behind it is absent. That is a courtesy to the
 * reader and not the security boundary: the server checks each of these permissions again on
 * every request, whatever the interface chose to show.
 */

type MovementKind = 'receive' | 'issue' | 'adjust' | 'transfer'

interface OpenDialog {
  kind: MovementKind
  /** The row's own product and store, or null when the action came from the page header. */
  preset: MovementPreset | null
}

export function StockOverviewPage() {
  const { t } = useTranslation(['inventory', 'common'])
  const describeError = useInventoryError()
  const formatNumber = useFormatNumber()
  const productLabel = useProductLabel()

  const canReceive = usePermission('inventory:receive')
  const canIssue = usePermission('inventory:issue')
  const canAdjust = usePermission('inventory:adjust')
  const canTransfer = usePermission('inventory:transfer')
  // The valuation endpoint needs both permissions, so the panel is asked for only when the reader
  // holds the money one as well. Without it the request would be refused, and asking would put a
  // failure on a screen the reader is otherwise entitled to read.
  const canSeeValue = usePermission('finance:view')

  const { filters, patch, clear } = useStockFilters()
  const stock = useStockList(filters)
  const low = useLowStockList()
  const valuation = useValuation(canSeeValue)
  const warehouses = useWarehouses()
  const categories = useProductCategories()

  const [showFilters, setShowFilters] = useState(() => countActiveStockFilters(filters) > 0)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // The search field keeps its own value so typing stays instant; the URL is rewritten only once
  // typing has stopped, which is also what stops one request going out per keystroke.
  const [search, setSearch] = useState(filters.q)
  const debouncedSearch = useDebouncedValue(search, 300)

  useEffect(() => {
    if (debouncedSearch.trim() === filters.q) return
    patch({ q: debouncedSearch.trim() })
  }, [debouncedSearch, filters.q, patch])

  const rows = stock.data?.items ?? []
  const meta = stock.data?.meta
  const lowRows = low.data?.items ?? []
  // The count comes from the low-stock read, which is not narrowed by this screen's filters: a
  // storekeeper looking at one store must still be told that something is running out in another.
  const lowCount = low.data?.lowCount ?? 0
  const activeFilters = countActiveStockFilters(filters)
  const filtersApplied = activeFilters > 0

  function clearEverything(): void {
    setSearch('')
    clear()
  }

  function openFor(kind: MovementKind, row: StockRow | null): void {
    setNotice(null)
    setDialog({ kind, preset: row === null ? null : presetFromStockRow(row) })
  }

  const anyAction = canReceive || canIssue || canAdjust || canTransfer

  const warehouseOptions: SelectOption[] = [
    { value: '', label: t('inventory:filters.anyWarehouse') },
    ...(warehouses.data ?? []).map((store) => ({ value: store.id, label: store.name })),
  ]
  const categoryOptions: SelectOption[] = [
    { value: '', label: t('inventory:filters.anyCategory') },
    ...(categories.data ?? []).map((row) => ({ value: row.id, label: row.name })),
  ]
  const sortOptions: SelectOption[] = STOCK_SORTS.map((value) => ({
    value,
    label: t(`inventory:stockSort.${value}`),
  }))

  const stockColumns: Column<StockRow>[] = [
    {
      key: 'product',
      header: t('inventory:stockColumns.product'),
      render: (row) => (
        <div className="min-w-0">
          <span className="block font-medium text-ink">
            {productLabel({ name: row.productName, nameRw: row.productNameRw })}
          </span>
          <span className="block text-xs text-ink-muted">{row.sku}</span>
        </div>
      ),
    },
    {
      key: 'category',
      header: t('inventory:stockColumns.category'),
      secondary: true,
      render: (row) =>
        row.categoryName ?? (
          <span className="text-ink-muted">{t('inventory:stock.noCategory')}</span>
        ),
    },
    {
      key: 'warehouse',
      header: t('inventory:stockColumns.warehouse'),
      render: (row) => row.warehouseName,
    },
    {
      key: 'quantity',
      header: t('inventory:stockColumns.quantity'),
      align: 'right',
      // `Quantity` writes the decimal string the server sent, with its unit. Never `Money`: a
      // weight is not an amount of francs and must not be shown as one.
      render: (row) => <Quantity value={row.quantity} unit={row.unitSymbol} />,
    },
    {
      key: 'minimum',
      header: t('inventory:stockColumns.minimum'),
      align: 'right',
      secondary: true,
      render: (row) =>
        row.minStockLevel === null ? (
          <span className="text-ink-muted">{t('inventory:stock.noMinimum')}</span>
        ) : (
          <Quantity value={row.minStockLevel} unit={row.unitSymbol} />
        ),
    },
    {
      key: 'state',
      header: t('inventory:stockColumns.state'),
      width: '9rem',
      // A low row is marked with a word and a dot, not with a colour alone, so it reads the same
      // on a monochrome printout and to somebody who cannot tell red from green.
      render: (row) =>
        row.isLow ? (
          <Badge tone="warning">{t('inventory:stock.low')}</Badge>
        ) : (
          <Badge tone="success">{t('inventory:stock.ok')}</Badge>
        ),
    },
  ]

  if (anyAction) {
    stockColumns.push({
      key: 'actions',
      header: t('inventory:stockColumns.actions'),
      align: 'right',
      width: '17rem',
      render: (row) => (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {canReceive ? (
            <Button variant="ghost" size="sm" onClick={() => openFor('receive', row)}>
              {t('inventory:actions.receive')}
            </Button>
          ) : null}
          {canIssue ? (
            <Button variant="ghost" size="sm" onClick={() => openFor('issue', row)}>
              {t('inventory:actions.issue')}
            </Button>
          ) : null}
          {canAdjust ? (
            <Button variant="ghost" size="sm" onClick={() => openFor('adjust', row)}>
              {t('inventory:actions.adjust')}
            </Button>
          ) : null}
          {canTransfer ? (
            <Button variant="ghost" size="sm" onClick={() => openFor('transfer', row)}>
              {t('inventory:actions.transfer')}
            </Button>
          ) : null}
        </div>
      ),
    })
  }

  const lowColumns: Column<StockRow>[] = [
    {
      key: 'product',
      header: t('inventory:stockColumns.product'),
      render: (row) => (
        <div className="min-w-0">
          <span className="block font-medium text-ink">
            {productLabel({ name: row.productName, nameRw: row.productNameRw })}
          </span>
          <span className="block text-xs text-ink-muted">{row.warehouseName}</span>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: t('inventory:stockColumns.quantity'),
      align: 'right',
      render: (row) => <Quantity value={row.quantity} unit={row.unitSymbol} />,
    },
    {
      key: 'minimum',
      header: t('inventory:stockColumns.minimum'),
      align: 'right',
      render: (row) =>
        row.minStockLevel === null ? (
          <span className="text-ink-muted">{t('inventory:stock.noMinimum')}</span>
        ) : (
          <Quantity value={row.minStockLevel} unit={row.unitSymbol} />
        ),
    },
  ]

  if (canReceive) {
    lowColumns.push({
      key: 'actions',
      header: t('inventory:stockColumns.actions'),
      align: 'right',
      width: '10rem',
      render: (row) => (
        <Button variant="ghost" size="sm" onClick={() => openFor('receive', row)}>
          {t('inventory:actions.receive')}
        </Button>
      ),
    })
  }

  const from = meta ? (meta.page - 1) * meta.pageSize + 1 : 0
  const to = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('inventory:overview.title')}
        description={t('inventory:overview.description')}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link to="/inventory/movements">
                {t('inventory:overview.toMovements')}
                <ArrowRight aria-hidden="true" className="ml-2 size-4" />
              </Link>
            </Button>
            {canReceive ? (
              <Button
                leadingIcon={<PackagePlus aria-hidden="true" className="size-4" />}
                onClick={() => openFor('receive', null)}
              >
                {t('inventory:actions.receive')}
              </Button>
            ) : null}
            {canIssue ? (
              <Button
                variant="secondary"
                leadingIcon={<PackageMinus aria-hidden="true" className="size-4" />}
                onClick={() => openFor('issue', null)}
              >
                {t('inventory:actions.issue')}
              </Button>
            ) : null}
            {canAdjust ? (
              <Button
                variant="secondary"
                leadingIcon={<ClipboardCheck aria-hidden="true" className="size-4" />}
                onClick={() => openFor('adjust', null)}
              >
                {t('inventory:actions.adjust')}
              </Button>
            ) : null}
            {canTransfer ? (
              <Button
                variant="secondary"
                leadingIcon={<ArrowLeftRight aria-hidden="true" className="size-4" />}
                onClick={() => openFor('transfer', null)}
              >
                {t('inventory:actions.transfer')}
              </Button>
            ) : null}
          </>
        }
      />

      {notice ? (
        <Alert
          tone="success"
          action={
            <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
              {t('common:actions.close')}
            </Button>
          }
        >
          {notice}
        </Alert>
      ) : null}

      {/*
        What needs attention, first on the screen. The count is the whole catalogue's, so a
        storekeeper who has narrowed the table below to one store is still told the total.
      */}
      <Panel
        title={t('inventory:lowStock.title')}
        description={
          lowCount > 0
            ? t('inventory:lowStock.countDescription', { total: formatNumber(lowCount) })
            : t('inventory:lowStock.noneDescription')
        }
        actions={
          lowCount > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => patch({ lowOnly: true, warehouseId: '', categoryId: '' })}
            >
              {t('inventory:lowStock.seeAll')}
            </Button>
          ) : undefined
        }
        flush
      >
        <DataTable
          rows={lowRows}
          columns={lowColumns}
          rowKey={(row) => `${row.productId}-${row.warehouseId}`}
          caption={t('inventory:lowStock.caption')}
          loading={low.isPending}
          empty={
            <EmptyState
              icon={PackageSearch}
              title={t('inventory:lowStock.emptyTitle')}
              description={t('inventory:lowStock.emptyBody')}
              headingLevel={3}
            />
          }
          mobileRow={(row) => (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink">
                  {productLabel({ name: row.productName, nameRw: row.productNameRw })}
                </span>
                <Quantity value={row.quantity} unit={row.unitSymbol} />
              </div>
              <span className="text-sm text-ink-muted">{row.warehouseName}</span>
            </div>
          )}
        />
      </Panel>

      {/*
        What the stock is worth, for a reader who may also read the books. The note about
        estimates is not a footnote: a cooperative taking this figure to a lender has to know how
        much of it rests on a list price rather than on a receipt.
      */}
      {canSeeValue && valuation.data ? (
        <Panel
          title={t('inventory:valuation.title')}
          description={t('inventory:valuation.description')}
        >
          <p className="text-2xl font-semibold text-ink">
            <Money value={valuation.data.total} />
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {valuation.data.estimatedCount > 0
              ? t('inventory:valuation.estimatedNote', {
                  total: formatNumber(valuation.data.estimatedCount),
                })
              : t('inventory:valuation.allCosted')}
          </p>
        </Panel>
      ) : null}

      <Panel flush>
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <FormField label={t('inventory:search.label')} className="min-w-56 flex-1">
              <Input
                type="search"
                placeholder={t('inventory:search.placeholder')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </FormField>

            <FormField label={t('inventory:filters.warehouse')} className="w-52">
              <Select
                options={warehouseOptions}
                value={filters.warehouseId}
                onChange={(event) => patch({ warehouseId: event.target.value })}
              />
            </FormField>

            <FormField label={t('inventory:filters.category')} className="w-52">
              <Select
                options={categoryOptions}
                value={filters.categoryId}
                onChange={(event) => patch({ categoryId: event.target.value })}
              />
            </FormField>

            <FormField label={t('inventory:stockSort.label')} className="w-56">
              <Select
                options={sortOptions}
                value={filters.sort}
                onChange={(event) => patch({ sort: readStockSort(event.target.value) })}
              />
            </FormField>

            <Button
              variant="secondary"
              aria-expanded={showFilters}
              aria-controls="inventory-more-filters"
              leadingIcon={<SlidersHorizontal aria-hidden="true" className="size-4" />}
              onClick={() => setShowFilters((open) => !open)}
            >
              {activeFilters > 0
                ? t('inventory:filters.showWithCount', { total: activeFilters })
                : t('inventory:filters.show')}
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
            id="inventory-more-filters"
            hidden={!showFilters}
            className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2"
          >
            <Switch
              checked={filters.lowOnly}
              onCheckedChange={(next) => patch({ lowOnly: next })}
              label={t('inventory:filters.lowOnly')}
              description={t('inventory:filters.lowOnlyHint')}
            />
            <Switch
              checked={filters.inStockOnly}
              onCheckedChange={(next) => patch({ inStockOnly: next })}
              label={t('inventory:filters.inStockOnly')}
              description={t('inventory:filters.inStockOnlyHint')}
            />
          </div>
        </div>

        {stock.isError ? (
          <div className="p-4">
            <Alert
              tone="danger"
              title={t('inventory:overview.loadFailed')}
              action={
                <Button variant="secondary" size="sm" onClick={() => void stock.refetch()}>
                  {t('common:actions.retry')}
                </Button>
              }
            >
              {describeError(stock.error).message}
            </Alert>
          </div>
        ) : (
          <>
            <DataTable
              rows={rows}
              columns={stockColumns}
              rowKey={(row) => `${row.productId}-${row.warehouseId}`}
              caption={t('inventory:stock.caption')}
              loading={stock.isPending}
              empty={
                filtersApplied ? (
                  <EmptyState
                    icon={SearchX}
                    title={t('inventory:stock.emptyFilteredTitle')}
                    description={t('inventory:stock.emptyFilteredBody')}
                    action={
                      <Button variant="secondary" onClick={clearEverything}>
                        {t('common:actions.clearFilters')}
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon={PackageSearch}
                    title={t('inventory:stock.emptyTitle')}
                    description={t('inventory:stock.emptyBody')}
                    action={
                      canReceive ? (
                        <Button onClick={() => openFor('receive', null)}>
                          {t('inventory:actions.receive')}
                        </Button>
                      ) : undefined
                    }
                  />
                )
              }
              mobileRow={(row) => (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">
                      {productLabel({ name: row.productName, nameRw: row.productNameRw })}
                    </span>
                    <Quantity value={row.quantity} unit={row.unitSymbol} />
                  </div>
                  <p className="text-sm text-ink-muted">
                    {row.sku} · {row.warehouseName}
                  </p>
                  {row.isLow ? (
                    <Badge tone="warning">{t('inventory:stock.low')}</Badge>
                  ) : (
                    <Badge tone="success">{t('inventory:stock.ok')}</Badge>
                  )}
                </div>
              )}
            />

            {meta && meta.total > 0 && !stock.isPending ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
                <p className="text-sm text-ink-muted">
                  {t('inventory:pagination.stock', {
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

      {/*
        The dialogs are mounted only while open, so each one starts from a clean sheet and needs
        no effect to reset itself when it opens again.
      */}
      {dialog?.kind === 'receive' ? (
        <ReceiveStockDialog
          open
          preset={dialog.preset}
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
          onDone={setNotice}
        />
      ) : null}

      {dialog?.kind === 'issue' ? (
        <IssueStockDialog
          open
          preset={dialog.preset}
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
          onDone={setNotice}
        />
      ) : null}

      {dialog?.kind === 'adjust' ? (
        <AdjustStockDialog
          open
          preset={dialog.preset}
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
          onDone={setNotice}
        />
      ) : null}

      {dialog?.kind === 'transfer' ? (
        <TransferStockDialog
          open
          preset={dialog.preset}
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
          onDone={setNotice}
        />
      ) : null}
    </div>
  )
}

/**
 * The select hands back a plain string. Narrowing it against the orderings the server accepts
 * means a hand-edited value in the address bar travels no further than here.
 */
function readStockSort(value: string): StockSort {
  return STOCK_SORTS.find((candidate) => candidate === value) ?? 'product'
}
