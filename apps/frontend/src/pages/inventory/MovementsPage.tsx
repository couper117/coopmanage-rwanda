import { History, SearchX, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatQuantity } from '@coopmanage/shared'
import { PageHeader } from '@/components/PageHeader'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  Input,
  Money,
  Panel,
  Quantity,
  Select,
  Textarea,
  type Column,
  type SelectOption,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import {
  countActiveMovementFilters,
  DIRECTIONS,
  MOVEMENT_SORTS,
  MOVEMENT_TYPES,
  type Direction,
  type MovementRow,
  type MovementSort,
  type MovementType,
} from '@/features/inventory/inventory.api'
import {
  useDebouncedValue,
  useFormatDate,
  useFormatNumber,
  useInventoryError,
  useMovementFilters,
  useMovementsList,
  useReverseMovement,
  useWarehouses,
} from '@/features/inventory/inventory.hooks'

/**
 * Every movement of stock the cooperative has recorded.
 *
 * This is the working screen of the store: a storekeeper narrows it to one product and one week
 * and reads the totals at the bottom. So the filters live in the URL, and the two totals in the
 * footer cover the whole filtered set rather than the page on screen.
 *
 * **Nothing here is ever removed.** A movement recorded in error is corrected by writing its
 * opposite, and both rows stay in the history pointing at each other. That is what makes a
 * shortfall auditable: a quantity that could quietly disappear from the history is a quantity
 * nobody can account for.
 *
 * So the reverse control is not offered on a row that has already been corrected — that row names
 * its correction instead — nor on a row that is itself a correction, which names what it corrects.
 * Correcting half of a transfer writes two entries rather than one, because undoing one half
 * alone would leave stock recorded in a store it never reached, and the sentence reported back
 * names both.
 *
 * The control is behind `inventory:adjust`, which the server checks again on every request
 * whatever the interface chose to show.
 */

export function MovementsPage() {
  const { t } = useTranslation(['inventory', 'common'])
  const describeError = useInventoryError()
  const formatDate = useFormatDate()
  const formatNumber = useFormatNumber()

  const canReverse = usePermission('inventory:adjust')

  const { filters, patch, clear } = useMovementFilters()
  const list = useMovementsList(filters)
  const warehouses = useWarehouses()
  const reverse = useReverseMovement()

  const [showFilters, setShowFilters] = useState(() => countActiveMovementFilters(filters) > 0)
  const [reversing, setReversing] = useState<MovementRow | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [search, setSearch] = useState(filters.q)
  const debouncedSearch = useDebouncedValue(search, 300)

  useEffect(() => {
    if (debouncedSearch.trim() === filters.q) return
    patch({ q: debouncedSearch.trim() })
  }, [debouncedSearch, filters.q, patch])

  const rows = list.data?.items ?? []
  const meta = list.data?.meta
  const totals = list.data?.totals
  const activeFilters = countActiveMovementFilters(filters)
  const filtersApplied = activeFilters > 0

  function clearEverything(): void {
    setSearch('')
    clear()
  }

  function submitReversal(): void {
    if (!reversing) return
    const trimmed = reason.trim()
    if (trimmed.length === 0) {
      // A correction with no reason is the entry an auditor asks about first.
      setReasonError(t('inventory:reverse.reasonRequired'))
      return
    }
    reverse.mutate(
      { id: reversing.id, reason: trimmed },
      {
        onSuccess: (result) => {
          const references = result.reversals.map((entry) => entry.reference)
          setNotice(
            // Two corrections for a transfer, one otherwise. Two separate sentences rather than a
            // list glued together, because a sentence assembled from fragments is wrong in
            // Kinyarwanda and the count is known here.
            references.length > 1
              ? t('inventory:reverse.donePair', {
                  reference: reversing.reference,
                  first: references[0] ?? '',
                  second: references[1] ?? '',
                })
              : t('inventory:reverse.done', {
                  reference: reversing.reference,
                  correction: references[0] ?? '',
                }),
          )
          setReversing(null)
          setReason('')
        },
      },
    )
  }

  const warehouseOptions: SelectOption[] = [
    { value: '', label: t('inventory:filters.anyWarehouse') },
    ...(warehouses.data ?? []).map((store) => ({ value: store.id, label: store.name })),
  ]
  const typeOptions: SelectOption[] = [
    { value: '', label: t('inventory:filters.anyType') },
    ...MOVEMENT_TYPES.map((value) => ({ value, label: t(`inventory:movementType.${value}`) })),
  ]
  const directionOptions: SelectOption[] = [
    { value: '', label: t('inventory:filters.anyDirection') },
    ...DIRECTIONS.map((value) => ({ value, label: t(`inventory:direction.${value}`) })),
  ]
  const sortOptions: SelectOption[] = MOVEMENT_SORTS.map((value) => ({
    value,
    label: t(`inventory:movementSort.${value}`),
  }))

  const columns: Column<MovementRow>[] = [
    {
      key: 'reference',
      header: t('inventory:movementColumns.reference'),
      render: (row) => (
        <div className="min-w-0">
          <span className="block font-medium text-ink">{row.reference}</span>
          {/* A correction says what it corrects, and a corrected row says what corrected it, so
              the pair can be read as a pair rather than as two unexplained movements. */}
          {row.reversalOfReference ? (
            <span className="block text-xs text-ink-muted">
              {t('inventory:movement.correctionOf', { reference: row.reversalOfReference })}
            </span>
          ) : null}
          {row.reversedByReference ? (
            <span className="block text-xs text-ink-muted">
              {t('inventory:movement.correctedBy', { reference: row.reversedByReference })}
            </span>
          ) : null}
          {row.counterpartyReference ? (
            <span className="block text-xs text-ink-muted">
              {t('inventory:movement.otherHalf', { reference: row.counterpartyReference })}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'occurredAt',
      header: t('inventory:movementColumns.occurredAt'),
      render: (row) => formatDate(row.occurredAt),
    },
    {
      key: 'type',
      header: t('inventory:movementColumns.type'),
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span>{t(`inventory:movementType.${row.type}`, { defaultValue: row.type })}</span>
          <Badge tone={row.direction === 'IN' ? 'success' : 'neutral'}>
            {t(`inventory:direction.${row.direction}`, { defaultValue: row.direction })}
          </Badge>
        </div>
      ),
    },
    {
      key: 'product',
      header: t('inventory:movementColumns.product'),
      render: (row) => (
        <div className="min-w-0">
          <span className="block text-ink">{row.productName}</span>
          <span className="block text-xs text-ink-muted">{row.sku}</span>
        </div>
      ),
    },
    {
      key: 'warehouse',
      header: t('inventory:movementColumns.warehouse'),
      render: (row) => row.warehouseName,
    },
    {
      key: 'quantity',
      header: t('inventory:movementColumns.quantity'),
      align: 'right',
      // The decimal string the server sent, with its unit. A quantity is never rendered as money.
      render: (row) => <Quantity value={row.quantity} unit={row.unitSymbol} />,
    },
    {
      key: 'member',
      header: t('inventory:movementColumns.member'),
      secondary: true,
      render: (row) =>
        row.memberName === null ? (
          <span className="text-ink-muted">{t('inventory:movement.noMember')}</span>
        ) : (
          row.memberName
        ),
    },
    {
      key: 'cost',
      header: t('inventory:movementColumns.cost'),
      align: 'right',
      secondary: true,
      render: (row) =>
        row.totalCost === null ? (
          <span className="text-ink-muted">{t('inventory:movement.noCost')}</span>
        ) : (
          <div className="flex flex-col">
            <Money value={row.totalCost} />
            {row.financeReference ? (
              <span className="text-xs text-ink-muted">
                {t('inventory:movement.postedAs', { reference: row.financeReference })}
              </span>
            ) : null}
          </div>
        ),
    },
  ]

  if (canReverse) {
    columns.push({
      key: 'actions',
      header: t('inventory:movementColumns.actions'),
      align: 'right',
      width: '11rem',
      render: (row) => {
        // A row already corrected offers no control: the correction is named in the first column
        // instead, and asking again could only be refused.
        if (row.reversedByReference !== null) {
          return (
            <span className="text-xs text-ink-muted">
              {t('inventory:movement.alreadyCorrected')}
            </span>
          )
        }
        if (row.reversalOfReference !== null) {
          return (
            <span className="text-xs text-ink-muted">{t('inventory:movement.isACorrection')}</span>
          )
        }
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNotice(null)
              reverse.reset()
              setReason('')
              setReasonError(null)
              setReversing(row)
            }}
          >
            {t('inventory:reverse.action')}
          </Button>
        )
      },
    })
  }

  const from = meta ? (meta.page - 1) * meta.pageSize + 1 : 0
  const to = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('inventory:movements.title')}
        description={t('inventory:movements.description')}
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
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <FormField label={t('inventory:movements.searchLabel')} className="min-w-56 flex-1">
              <Input
                type="search"
                placeholder={t('inventory:movements.searchPlaceholder')}
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

            <FormField label={t('inventory:filters.type')} className="w-52">
              <Select
                options={typeOptions}
                value={filters.type}
                onChange={(event) => patch({ type: readType(event.target.value) })}
              />
            </FormField>

            <FormField label={t('inventory:movementSort.label')} className="w-56">
              <Select
                options={sortOptions}
                value={filters.sort}
                onChange={(event) => patch({ sort: readSort(event.target.value) })}
              />
            </FormField>

            <Button
              variant="secondary"
              aria-expanded={showFilters}
              aria-controls="movements-more-filters"
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
            id="movements-more-filters"
            hidden={!showFilters}
            className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            <FormField label={t('inventory:filters.direction')}>
              <Select
                options={directionOptions}
                value={filters.direction}
                onChange={(event) => patch({ direction: readDirection(event.target.value) })}
              />
            </FormField>
            <FormField label={t('inventory:filters.from')}>
              <Input
                type="date"
                value={filters.from}
                onChange={(event) => patch({ from: event.target.value })}
              />
            </FormField>
            <FormField label={t('inventory:filters.to')}>
              <Input
                type="date"
                value={filters.to}
                onChange={(event) => patch({ to: event.target.value })}
              />
            </FormField>
          </div>

          {/*
            A view narrowed to one product or one member arrives by link from the stock screen or
            a member's profile. There is no picker for either here — the search box already covers
            the product by name and by code — so the narrowing is stated and can be undone.
          */}
          {filters.productId ? (
            <div className="flex items-center gap-2">
              <Badge tone="info">{t('inventory:movements.oneProductOnly')}</Badge>
              <Button variant="link" size="sm" onClick={() => patch({ productId: '' })}>
                {t('inventory:movements.showEveryProduct')}
              </Button>
            </div>
          ) : null}

          {filters.memberId ? (
            <div className="flex items-center gap-2">
              <Badge tone="info">{t('inventory:movements.oneMemberOnly')}</Badge>
              <Button variant="link" size="sm" onClick={() => patch({ memberId: '' })}>
                {t('inventory:movements.showEveryMember')}
              </Button>
            </div>
          ) : null}
        </div>

        {list.isError ? (
          <div className="p-4">
            <Alert
              tone="danger"
              title={t('inventory:movements.loadFailed')}
              action={
                <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
                  {t('common:actions.retry')}
                </Button>
              }
            >
              {describeError(list.error).message}
            </Alert>
          </div>
        ) : (
          <>
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(row) => row.id}
              caption={t('inventory:movements.caption')}
              loading={list.isPending}
              rowMuted={(row) => row.reversedByReference !== null}
              footer={
                totals ? (
                  /* One cell across the table: the two quantities belong together as a sentence
                     about the filter, not as two numbers under two unrelated columns. */
                  <td colSpan={columns.length} className="px-3 py-2 text-sm">
                    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span>
                        {t('inventory:movements.totalIn')} <Quantity value={totals.in} />
                      </span>
                      <span>
                        {t('inventory:movements.totalOut')} <Quantity value={totals.out} />
                      </span>
                      <span className="text-ink-muted">{t('inventory:movements.totalsCover')}</span>
                    </span>
                  </td>
                ) : undefined
              }
              empty={
                filtersApplied ? (
                  <EmptyState
                    icon={SearchX}
                    title={t('inventory:movements.emptyFilteredTitle')}
                    description={t('inventory:movements.emptyFilteredBody')}
                    action={
                      <Button variant="secondary" onClick={clearEverything}>
                        {t('common:actions.clearFilters')}
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon={History}
                    title={t('inventory:movements.emptyTitle')}
                    description={t('inventory:movements.emptyBody')}
                  />
                )
              }
              mobileRow={(row) => (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{row.reference}</span>
                    <Quantity value={row.quantity} unit={row.unitSymbol} />
                  </div>
                  <p className="text-sm text-ink">{row.productName}</p>
                  <p className="text-sm text-ink-muted">
                    {formatDate(row.occurredAt)} · {row.warehouseName}
                  </p>
                  <Badge tone={row.direction === 'IN' ? 'success' : 'neutral'}>
                    {t(`inventory:movementType.${row.type}`, { defaultValue: row.type })}
                  </Badge>
                </div>
              )}
            />

            {meta && meta.total > 0 && !list.isPending ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
                <p className="text-sm text-ink-muted">
                  {t('inventory:pagination.movements', {
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

      <Dialog
        open={reversing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReversing(null)
            setReason('')
            setReasonError(null)
          }
        }}
        width="sm"
        busy={reverse.isPending}
        title={t('inventory:reverse.title')}
        description={
          reversing
            ? t('inventory:reverse.description', {
                reference: reversing.reference,
                quantity: formatQuantity(reversing.quantity, reversing.unitSymbol),
              })
            : undefined
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setReversing(null)}
              disabled={reverse.isPending}
            >
              {/* Not the shared "Cancel", which here would sit next to a control that corrects a
                  movement and read as its opposite. */}
              {t('inventory:reverse.keep')}
            </Button>
            <Button variant="danger" onClick={submitReversal} loading={reverse.isPending}>
              {t('inventory:reverse.confirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {/* Said outright: this writes a correction, it does not remove the movement. */}
          <p className="text-sm text-ink-secondary">{t('inventory:reverse.consequence')}</p>
          {reversing?.counterpartyReference ? (
            <Alert tone="info">{t('inventory:reverse.transferWarning')}</Alert>
          ) : null}
          <FormField
            label={t('inventory:reverse.reason')}
            hint={t('inventory:reverse.reasonHint')}
            error={reasonError ?? undefined}
          >
            <Textarea
              rows={3}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                setReasonError(null)
              }}
            />
          </FormField>
          {reverse.isError ? (
            <Alert tone="danger">{describeError(reverse.error).message}</Alert>
          ) : null}
        </div>
      </Dialog>
    </div>
  )
}

/**
 * The select elements hand back a plain string. These three narrow it against the values the
 * server accepts, so a hand-edited option in the address bar travels no further than here.
 */
function readType(value: string): MovementType | '' {
  return MOVEMENT_TYPES.find((candidate) => candidate === value) ?? ''
}

function readDirection(value: string): Direction | '' {
  return DIRECTIONS.find((candidate) => candidate === value) ?? ''
}

function readSort(value: string): MovementSort {
  return MOVEMENT_SORTS.find((candidate) => candidate === value) ?? '-occurredAt'
}
