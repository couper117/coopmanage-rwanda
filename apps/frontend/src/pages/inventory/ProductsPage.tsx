import { FolderTree, Package, Plus, SearchX, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  Input,
  Money,
  Panel,
  Quantity,
  Select,
  Switch,
  Textarea,
  type Column,
  type SelectOption,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { ProductDialog } from '@/features/inventory/ProductDialog'
import {
  countActiveProductFilters,
  PRODUCT_SORTS,
  PRODUCT_TYPES,
  type ProductCategoryRow,
  type ProductRow,
  type ProductSort,
  type ProductType,
} from '@/features/inventory/inventory.api'
import {
  useCreateProductCategory,
  useDebouncedValue,
  useFormatNumber,
  useInventoryError,
  useProductCategories,
  useProductFilters,
  useProductLabel,
  useProductsList,
  useUpdateProduct,
  useUpdateProductCategory,
} from '@/features/inventory/inventory.hooks'

/**
 * What the cooperative deals in.
 *
 * The catalogue is the list every other stock screen depends on, so it shows the facts those
 * screens use: the code, both names, the category, the unit, whether the product is counted at
 * all, what is on hand and the minimum somebody asked to be warned about.
 *
 * **Retiring is the only removal there is.** A product is never deleted, because movements
 * already recorded against it still have to be able to name it, and a report covering last season
 * has to say what was received and in what unit. A retired product takes no new movements and can
 * be put back in service at any time.
 *
 * **The categories live on this screen rather than on one of their own.** There are rarely more
 * than a dozen of them, they are only ever read alongside the products, and a separate screen for
 * a dozen rows is a screen nobody finds. Nesting is one level deep: the server refuses a parent
 * that already has a parent, so only a top-level category is offered as one.
 *
 * Every control is hidden without `products:manage`, which is a courtesy to the reader and not
 * the security boundary: the server checks the permission again on every request.
 */

export function ProductsPage() {
  const { t } = useTranslation(['inventory', 'common'])
  const describeError = useInventoryError()
  const formatNumber = useFormatNumber()
  const productLabel = useProductLabel()

  const canManage = usePermission('products:manage')

  const { filters, patch, clear } = useProductFilters()
  const products = useProductsList(filters)
  // Every category, including the retired ones: a retired category still has to be findable and
  // restorable, and products already in it still name it.
  const categories = useProductCategories({ includeInactive: true })
  const updateProduct = useUpdateProduct()
  const createCategory = useCreateProductCategory()
  const updateCategory = useUpdateProductCategory()

  const [editing, setEditing] = useState<{ product: ProductRow | null } | null>(null)
  const [retiring, setRetiring] = useState<ProductRow | null>(null)
  const [categoryForm, setCategoryForm] = useState<{ category: ProductCategoryRow | null } | null>(
    null,
  )
  const [categoryName, setCategoryName] = useState('')
  const [categoryNameRw, setCategoryNameRw] = useState('')
  const [categoryParentId, setCategoryParentId] = useState('')
  const [categoryDescription, setCategoryDescription] = useState('')
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [search, setSearch] = useState(filters.q)
  const debouncedSearch = useDebouncedValue(search, 300)

  useEffect(() => {
    if (debouncedSearch.trim() === filters.q) return
    patch({ q: debouncedSearch.trim() })
  }, [debouncedSearch, filters.q, patch])

  const rows = products.data?.items ?? []
  const meta = products.data?.meta
  const categoryRows = categories.data ?? []
  const activeFilters = countActiveProductFilters(filters)
  const filtersApplied = activeFilters > 0

  function clearEverything(): void {
    setSearch('')
    clear()
  }

  function openCategoryForm(category: ProductCategoryRow | null): void {
    setNotice(null)
    setCategoryError(null)
    createCategory.reset()
    updateCategory.reset()
    setCategoryName(category?.name ?? '')
    setCategoryNameRw(category?.nameRw ?? '')
    setCategoryParentId(category?.parentId ?? '')
    setCategoryDescription(category?.description ?? '')
    setCategoryForm({ category })
  }

  function submitCategory(): void {
    if (!categoryForm) return
    const name = categoryName.trim()
    if (name.length === 0) {
      setCategoryError(t('inventory:categoryErrors.name'))
      return
    }
    const existing = categoryForm.category
    if (existing === null) {
      createCategory.mutate(
        {
          name,
          ...(categoryNameRw.trim() ? { nameRw: categoryNameRw.trim() } : {}),
          ...(categoryParentId ? { parentId: categoryParentId } : {}),
          ...(categoryDescription.trim() ? { description: categoryDescription.trim() } : {}),
        },
        {
          onSuccess: (saved) => {
            setNotice(t('inventory:categories.added', { name: saved.name }))
            setCategoryForm(null)
          },
        },
      )
      return
    }
    updateCategory.mutate(
      {
        id: existing.id,
        changes: {
          name,
          nameRw: categoryNameRw.trim() || null,
          description: categoryDescription.trim() || null,
        },
      },
      {
        onSuccess: (saved) => {
          setNotice(t('inventory:categories.saved', { name: saved.name }))
          setCategoryForm(null)
        },
      },
    )
  }

  function confirmRetire(): void {
    if (!retiring) return
    const next = !retiring.isActive
    updateProduct.mutate(
      { id: retiring.id, changes: { isActive: next } },
      {
        onSuccess: (saved) => {
          setNotice(
            t(next ? 'inventory:products.restored' : 'inventory:products.retired', {
              name: saved.name,
            }),
          )
          setRetiring(null)
        },
      },
    )
  }

  const categoryOptions: SelectOption[] = [
    { value: '', label: t('inventory:filters.anyCategory') },
    ...categoryRows.map((row) => ({ value: row.id, label: row.name })),
  ]
  const typeOptions: SelectOption[] = [
    { value: '', label: t('inventory:filters.anyType') },
    ...PRODUCT_TYPES.map((value) => ({ value, label: t(`inventory:productType.${value}`) })),
  ]
  const trackedOptions: SelectOption[] = [
    { value: '', label: t('inventory:filters.anyCounted') },
    { value: 'true', label: t('inventory:filters.countedOnly') },
    { value: 'false', label: t('inventory:filters.uncountedOnly') },
  ]
  const sortOptions: SelectOption[] = PRODUCT_SORTS.map((value) => ({
    value,
    label: t(`inventory:productSort.${value}`),
  }))

  /** Only a top-level category can be a parent: the server refuses a second level of nesting. */
  const parentOptions: SelectOption[] = [
    { value: '', label: t('inventory:categoryFields.parentNone') },
    ...categoryRows
      .filter((row) => row.parentId === null && row.isActive)
      .map((row) => ({ value: row.id, label: row.name })),
  ]

  const columns: Column<ProductRow>[] = [
    {
      key: 'sku',
      header: t('inventory:productColumns.sku'),
      render: (row) => <span className="font-medium text-ink">{row.sku}</span>,
    },
    {
      key: 'name',
      header: t('inventory:productColumns.name'),
      render: (row) => (
        <div className="min-w-0">
          <span className="block text-ink">{productLabel(row)}</span>
          {row.nameRw ? (
            <span className="block text-xs text-ink-muted">{row.nameRw}</span>
          ) : (
            <span className="block text-xs text-ink-muted">{t('inventory:products.noNameRw')}</span>
          )}
        </div>
      ),
    },
    {
      key: 'category',
      header: t('inventory:productColumns.category'),
      secondary: true,
      render: (row) =>
        row.categoryName ?? (
          <span className="text-ink-muted">{t('inventory:stock.noCategory')}</span>
        ),
    },
    {
      key: 'unit',
      header: t('inventory:productColumns.unit'),
      render: (row) => `${row.unitName} (${row.unitSymbol})`,
    },
    {
      key: 'counted',
      header: t('inventory:productColumns.counted'),
      render: (row) =>
        row.trackInventory ? (
          <Badge tone="info">{t('inventory:products.counted')}</Badge>
        ) : (
          <Badge tone="neutral">{t('inventory:products.notCounted')}</Badge>
        ),
    },
    {
      key: 'onHand',
      header: t('inventory:productColumns.onHand'),
      align: 'right',
      // Null means the product is not counted at all, which is a different statement from zero.
      render: (row) =>
        row.quantityOnHand === null ? (
          <span className="text-ink-muted">{t('inventory:products.notCountedShort')}</span>
        ) : (
          <Quantity value={row.quantityOnHand} unit={row.unitSymbol} />
        ),
    },
    {
      key: 'minimum',
      header: t('inventory:productColumns.minimum'),
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
      key: 'price',
      header: t('inventory:productColumns.salePrice'),
      align: 'right',
      secondary: true,
      render: (row) =>
        row.defaultSalePrice === null ? (
          <span className="text-ink-muted">{t('inventory:products.noPrice')}</span>
        ) : (
          <Money value={row.defaultSalePrice} />
        ),
    },
    {
      key: 'state',
      header: t('inventory:productColumns.state'),
      render: (row) => (
        <Badge tone={row.isActive ? 'success' : 'neutral'}>
          {t(row.isActive ? 'inventory:products.active' : 'inventory:products.retiredState')}
        </Badge>
      ),
    },
  ]

  if (canManage) {
    columns.push({
      key: 'actions',
      header: t('inventory:productColumns.actions'),
      align: 'right',
      width: '13rem',
      render: (row) => (
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNotice(null)
              setEditing({ product: row })
            }}
          >
            {t('common:actions.edit')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNotice(null)
              updateProduct.reset()
              setRetiring(row)
            }}
          >
            {t(row.isActive ? 'inventory:products.retire' : 'inventory:products.restore')}
          </Button>
        </div>
      ),
    })
  }

  const categoryColumns: Column<ProductCategoryRow>[] = [
    {
      key: 'name',
      header: t('inventory:categoryColumns.name'),
      render: (row) => (
        <div className="min-w-0">
          <span className="block text-ink">{row.name}</span>
          {row.parentName ? (
            <span className="block text-xs text-ink-muted">
              {t('inventory:categories.inside', { parent: row.parentName })}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'nameRw',
      header: t('inventory:categoryColumns.nameRw'),
      render: (row) =>
        row.nameRw ?? <span className="text-ink-muted">{t('inventory:products.noNameRw')}</span>,
    },
    {
      key: 'products',
      header: t('inventory:categoryColumns.products'),
      align: 'right',
      render: (row) => formatNumber(row.productCount),
    },
    {
      key: 'state',
      header: t('inventory:categoryColumns.state'),
      render: (row) => (
        <Badge tone={row.isActive ? 'success' : 'neutral'}>
          {t(row.isActive ? 'inventory:categories.active' : 'inventory:categories.inactive')}
        </Badge>
      ),
    },
  ]

  if (canManage) {
    categoryColumns.push({
      key: 'actions',
      header: t('inventory:categoryColumns.actions'),
      align: 'right',
      width: '13rem',
      render: (row) => (
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => openCategoryForm(row)}>
            {t('common:actions.edit')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              updateCategory.mutate(
                { id: row.id, changes: { isActive: !row.isActive } },
                {
                  onSuccess: (saved) =>
                    setNotice(
                      t(
                        saved.isActive
                          ? 'inventory:categories.restoredNotice'
                          : 'inventory:categories.deactivatedNotice',
                        { name: saved.name },
                      ),
                    ),
                },
              )
            }
          >
            {t(row.isActive ? 'inventory:categories.deactivate' : 'inventory:categories.restore')}
          </Button>
        </div>
      ),
    })
  }

  const from = meta ? (meta.page - 1) * meta.pageSize + 1 : 0
  const to = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0
  const categorySaving = createCategory.isPending || updateCategory.isPending
  const categoryFailure = createCategory.error ?? updateCategory.error

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('inventory:products.title')}
        description={t('inventory:products.description')}
        actions={
          canManage ? (
            <Button
              leadingIcon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => {
                setNotice(null)
                setEditing({ product: null })
              }}
            >
              {t('inventory:products.add')}
            </Button>
          ) : undefined
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

      <Panel flush>
        <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
          <FormField label={t('inventory:products.searchLabel')} className="min-w-56 flex-1">
            <Input
              type="search"
              placeholder={t('inventory:products.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </FormField>

          <FormField label={t('inventory:filters.category')} className="w-48">
            <Select
              options={categoryOptions}
              value={filters.categoryId}
              onChange={(event) => patch({ categoryId: event.target.value })}
            />
          </FormField>

          <FormField label={t('inventory:filters.type')} className="w-44">
            <Select
              options={typeOptions}
              value={filters.type}
              onChange={(event) => patch({ type: readType(event.target.value) })}
            />
          </FormField>

          <FormField label={t('inventory:filters.counted')} className="w-44">
            <Select
              options={trackedOptions}
              value={filters.tracked}
              onChange={(event) => patch({ tracked: readTracked(event.target.value) })}
            />
          </FormField>

          <FormField label={t('inventory:productSort.label')} className="w-48">
            <Select
              options={sortOptions}
              value={filters.sort}
              onChange={(event) => patch({ sort: readSort(event.target.value) })}
            />
          </FormField>

          <div className="flex items-center">
            <Switch
              checked={filters.includeInactive}
              onCheckedChange={(next) => patch({ includeInactive: next })}
              label={t('inventory:filters.includeRetired')}
            />
          </div>

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

        {products.isError ? (
          <div className="p-4">
            <Alert
              tone="danger"
              title={t('inventory:products.loadFailed')}
              action={
                <Button variant="secondary" size="sm" onClick={() => void products.refetch()}>
                  {t('common:actions.retry')}
                </Button>
              }
            >
              {describeError(products.error).message}
            </Alert>
          </div>
        ) : (
          <>
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(row) => row.id}
              caption={t('inventory:products.caption')}
              loading={products.isPending}
              rowMuted={(row) => !row.isActive}
              empty={
                filtersApplied ? (
                  <EmptyState
                    icon={SearchX}
                    title={t('inventory:products.emptyFilteredTitle')}
                    description={t('inventory:products.emptyFilteredBody')}
                    action={
                      <Button variant="secondary" onClick={clearEverything}>
                        {t('common:actions.clearFilters')}
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon={Package}
                    title={t('inventory:products.emptyTitle')}
                    description={t('inventory:products.emptyBody')}
                    action={
                      canManage ? (
                        <Button onClick={() => setEditing({ product: null })}>
                          {t('inventory:products.add')}
                        </Button>
                      ) : undefined
                    }
                  />
                )
              }
              mobileRow={(row) => (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{productLabel(row)}</span>
                    {row.quantityOnHand === null ? null : (
                      <Quantity value={row.quantityOnHand} unit={row.unitSymbol} />
                    )}
                  </div>
                  <p className="text-sm text-ink-muted">
                    {row.sku} · {row.unitSymbol}
                  </p>
                </div>
              )}
            />

            {meta && meta.total > 0 && !products.isPending ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
                <p className="text-sm text-ink-muted">
                  {t('inventory:pagination.products', {
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

      <Panel
        title={t('inventory:categories.title')}
        description={t('inventory:categories.description')}
        actions={
          canManage ? (
            <Button variant="secondary" size="sm" onClick={() => openCategoryForm(null)}>
              {t('inventory:categories.add')}
            </Button>
          ) : undefined
        }
        flush
      >
        <DataTable
          rows={categoryRows}
          columns={categoryColumns}
          rowKey={(row) => row.id}
          caption={t('inventory:categories.caption')}
          loading={categories.isPending}
          rowMuted={(row) => !row.isActive}
          empty={
            <EmptyState
              icon={FolderTree}
              title={t('inventory:categories.emptyTitle')}
              description={t('inventory:categories.emptyBody')}
              headingLevel={3}
              action={
                canManage ? (
                  <Button variant="secondary" onClick={() => openCategoryForm(null)}>
                    {t('inventory:categories.add')}
                  </Button>
                ) : undefined
              }
            />
          }
          mobileRow={(row) => (
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink">{row.name}</span>
              <span className="text-sm text-ink-muted">{formatNumber(row.productCount)}</span>
            </div>
          )}
        />
      </Panel>

      {/* Mounted only while open, so each opening starts from the values just loaded into it. */}
      {editing !== null ? (
        <ProductDialog
          open
          product={editing.product}
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          onDone={setNotice}
        />
      ) : null}

      <ConfirmDialog
        open={retiring !== null}
        onOpenChange={(open) => {
          if (!open) setRetiring(null)
        }}
        tone={retiring?.isActive === false ? 'primary' : 'danger'}
        busy={updateProduct.isPending}
        title={t(
          retiring?.isActive === false
            ? 'inventory:products.restoreTitle'
            : 'inventory:products.retireTitle',
          { name: retiring?.name ?? '' },
        )}
        consequence={t(
          retiring?.isActive === false
            ? 'inventory:products.restoreConsequence'
            : 'inventory:products.retireConsequence',
        )}
        confirmLabel={t(
          retiring?.isActive === false
            ? 'inventory:products.restoreConfirm'
            : 'inventory:products.retireConfirm',
        )}
        onConfirm={confirmRetire}
        error={updateProduct.isError ? describeError(updateProduct.error).message : null}
      />

      <Dialog
        open={categoryForm !== null}
        onOpenChange={(open) => {
          if (!open) setCategoryForm(null)
        }}
        width="sm"
        busy={categorySaving}
        title={t(
          categoryForm?.category
            ? 'inventory:categories.editTitle'
            : 'inventory:categories.addTitle',
        )}
        description={t('inventory:categories.formDescription')}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={categorySaving}
              onClick={() => setCategoryForm(null)}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={submitCategory} loading={categorySaving}>
              {t('common:actions.save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {categoryFailure ? (
            <Alert tone="danger">{describeError(categoryFailure).message}</Alert>
          ) : null}
          <FormField label={t('inventory:categoryFields.name')} error={categoryError ?? undefined}>
            <Input
              value={categoryName}
              onChange={(event) => {
                setCategoryName(event.target.value)
                setCategoryError(null)
              }}
            />
          </FormField>
          <FormField
            label={t('inventory:categoryFields.nameRw')}
            optional
            hint={t('inventory:categoryFields.nameRwHint')}
          >
            <Input
              value={categoryNameRw}
              onChange={(event) => setCategoryNameRw(event.target.value)}
            />
          </FormField>
          {categoryForm?.category === null ? (
            <FormField
              label={t('inventory:categoryFields.parent')}
              optional
              hint={t('inventory:categoryFields.parentHint')}
            >
              <Select
                options={parentOptions}
                value={categoryParentId}
                onChange={(event) => setCategoryParentId(event.target.value)}
              />
            </FormField>
          ) : null}
          <FormField label={t('inventory:categoryFields.description')} optional>
            <Textarea
              rows={2}
              value={categoryDescription}
              onChange={(event) => setCategoryDescription(event.target.value)}
            />
          </FormField>
        </div>
      </Dialog>
    </div>
  )
}

/** The selects hand back plain strings, narrowed here against what the server accepts. */
function readType(value: string): ProductType | '' {
  return PRODUCT_TYPES.find((candidate) => candidate === value) ?? ''
}

function readTracked(value: string): 'true' | 'false' | '' {
  return value === 'true' ? 'true' : value === 'false' ? 'false' : ''
}

function readSort(value: string): ProductSort {
  return PRODUCT_SORTS.find((candidate) => candidate === value) ?? 'name'
}
