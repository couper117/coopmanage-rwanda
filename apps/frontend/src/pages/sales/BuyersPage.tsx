import { Pencil, Receipt, SearchX, UserPlus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
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
  Select,
  Switch,
  type Column,
  type SelectOption,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { BuyerDialog } from '@/features/sales/BuyerDialog'
import { BUYER_SORTS, type BuyerRow, type BuyerSort } from '@/features/sales/sales.api'
import {
  useBuyerFilters,
  useBuyersList,
  useFormatDate,
  useFormatNumber,
  useSalesError,
} from '@/features/sales/sales.hooks'
import { useDebouncedValue } from '@/features/members/members.hooks'

/**
 * Who the cooperative sells to.
 *
 * The three figures beside each buyer — how many sales, what they have bought, what they still owe
 * — count **confirmed sales only**. A draft is an intention somebody typed rather than business the
 * cooperative did, and a cancelled sale is business that was undone; counting either would
 * overstate every buyer's history and send somebody to chase a debt that does not exist.
 *
 * A buyer is never deleted, because every confirmed sale names them and a report covering last
 * season has to be able to say who bought the maize. Taking one out of use is the only removal.
 */
export function BuyersPage() {
  const { t } = useTranslation(['sales', 'common'])
  const navigate = useNavigate()
  const describeError = useSalesError()
  const formatDate = useFormatDate()
  const formatNumber = useFormatNumber()

  const canManage = usePermission('buyers:manage')

  const { filters, patch } = useBuyerFilters()
  const list = useBuyersList(filters)

  const [search, setSearch] = useState(filters.q)
  const debounced = useDebouncedValue(search, 300)
  const [editing, setEditing] = useState<BuyerRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // The box keeps its own value so typing stays instant; the address bar is only rewritten once
  // typing has stopped, which is also what stops one request going out per keystroke.
  useEffect(() => {
    if (debounced !== filters.q) patch({ q: debounced })
  }, [debounced, filters.q, patch])

  const rows = list.data?.items ?? []
  const meta = list.data?.meta
  const searching = filters.q.trim().length > 0

  const sortOptions: SelectOption[] = BUYER_SORTS.map((value) => ({
    value,
    label: t(value === 'name' ? 'sales:buyers.sortName' : 'sales:buyers.sortNameDescending'),
  }))

  const columns: Column<BuyerRow>[] = [
    {
      key: 'name',
      header: t('sales:buyers.columns.name'),
      render: (row) => (
        <div className="min-w-0">
          <span className="block truncate font-medium text-ink">{row.name}</span>
          <span className="block truncate text-sm text-ink-muted">
            {row.organization ?? t('sales:buyers.noOrganization')}
          </span>
        </div>
      ),
    },
    {
      key: 'contact',
      header: t('sales:buyers.columns.contact'),
      secondary: true,
      render: (row) => (
        <span className="text-sm text-ink-muted">
          {row.phone ?? row.email ?? row.contactPerson ?? t('sales:buyers.noContact')}
        </span>
      ),
    },
    {
      key: 'place',
      header: t('sales:buyers.columns.place'),
      secondary: true,
      render: (row) => (
        <span className="text-sm text-ink-muted">
          {[row.sector, row.district].filter(Boolean).join(', ') || t('sales:buyers.noPlace')}
        </span>
      ),
    },
    {
      key: 'sales',
      header: t('sales:buyers.columns.sales'),
      align: 'right',
      render: (row) => formatNumber(row.saleCount),
    },
    {
      key: 'totalSold',
      header: t('sales:buyers.columns.totalSold'),
      align: 'right',
      render: (row) => <Money value={row.totalSold} />,
    },
    {
      key: 'outstanding',
      header: t('sales:buyers.columns.outstanding'),
      align: 'right',
      render: (row) => (
        <Money value={row.outstanding} tone={row.outstanding === '0.00' ? 'neutral' : 'out'} />
      ),
    },
    {
      key: 'lastSale',
      header: t('sales:buyers.columns.lastSale'),
      secondary: true,
      render: (row) =>
        row.lastSaleDate ? formatDate(row.lastSaleDate) : t('sales:buyers.noSaleYet'),
    },
    {
      key: 'state',
      header: t('sales:buyers.columns.state'),
      render: (row) => (
        <Badge tone={row.isActive ? 'success' : 'neutral'}>
          {t(row.isActive ? 'sales:buyers.active' : 'sales:buyers.inactive')}
        </Badge>
      ),
    },
  ]

  if (canManage) {
    columns.push({
      key: 'actions',
      header: t('sales:buyers.columns.actions'),
      align: 'right',
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<Pencil aria-hidden="true" className="size-4" />}
          onClick={(event) => {
            event.stopPropagation()
            setNotice(null)
            setEditing(row)
          }}
        >
          {t('sales:buyers.edit')}
        </Button>
      ),
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('sales:buyers.title')}
        description={t('sales:buyers.description')}
        actions={
          <>
            <Button
              variant="secondary"
              asChild
              leadingIcon={<Receipt aria-hidden="true" className="size-4" />}
            >
              <Link to="/sales">{t('sales:buyers.toSales')}</Link>
            </Button>
            {canManage ? (
              <Button
                leadingIcon={<UserPlus aria-hidden="true" className="size-4" />}
                onClick={() => {
                  setNotice(null)
                  setAdding(true)
                }}
              >
                {t('sales:buyers.addBuyer')}
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

      {list.isError ? <Alert tone="danger">{describeError(list.error).message}</Alert> : null}

      <Panel flush>
        <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
          <FormField label={t('sales:buyers.search')} className="min-w-56 flex-1">
            <Input
              type="search"
              placeholder={t('sales:buyers.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </FormField>

          <FormField label={t('sales:buyers.sortLabel')} className="w-44">
            <Select
              options={sortOptions}
              value={filters.sort}
              onChange={(event) => patch({ sort: event.target.value as BuyerSort })}
            />
          </FormField>

          <Switch
            label={t('sales:buyers.includeInactive')}
            description={t('sales:buyers.includeInactiveHint')}
            checked={filters.includeInactive}
            onCheckedChange={(next) => patch({ includeInactive: next })}
          />
        </div>

        <p className="border-b border-line px-4 py-2 text-sm text-ink-muted">
          {t('sales:buyers.totalsCover')}
        </p>

        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t('sales:buyers.caption')}
          loading={list.isPending}
          rowMuted={(row) => !row.isActive}
          onRowClick={(row) => void navigate(`/buyers/${row.id}`)}
          empty={
            searching ? (
              <EmptyState
                icon={SearchX}
                title={t('sales:buyers.emptyFilteredTitle')}
                description={t('sales:buyers.emptyFilteredBody')}
                action={
                  <Button variant="secondary" onClick={() => setSearch('')}>
                    {t('common:actions.clearFilters')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Users}
                title={t('sales:buyers.emptyTitle')}
                description={t('sales:buyers.emptyBody')}
                action={
                  canManage ? (
                    <Button onClick={() => setAdding(true)}>{t('sales:buyers.addBuyer')}</Button>
                  ) : undefined
                }
              />
            )
          }
          mobileRow={(row) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">{row.name}</span>
                <Money value={row.totalSold} />
              </div>
              <p className="text-sm text-ink-muted">{row.phone ?? t('sales:buyers.noContact')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={row.isActive ? 'success' : 'neutral'}>
                  {t(row.isActive ? 'sales:buyers.active' : 'sales:buyers.inactive')}
                </Badge>
                {row.outstanding === '0.00' ? null : (
                  <span className="text-sm text-ink-muted">
                    {t('sales:buyers.columns.outstanding')}: <Money value={row.outstanding} />
                  </span>
                )}
              </div>
            </div>
          )}
        />

        {meta && meta.total > 0 && !list.isPending ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
            <p className="text-sm text-ink-muted">
              {t('sales:pagination.buyers', {
                from: formatNumber((meta.page - 1) * meta.pageSize + 1),
                to: formatNumber(Math.min(meta.page * meta.pageSize, meta.total)),
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
      </Panel>

      <BuyerDialog open={adding} onOpenChange={setAdding} onDone={setNotice} />
      <BuyerDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        buyer={editing}
        onDone={setNotice}
      />
    </div>
  )
}
