import { ArrowLeft, Pencil, Receipt } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Money,
  Panel,
  Skeleton,
  type BadgeTone,
  type Column,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { BuyerDialog } from '@/features/sales/BuyerDialog'
import type { SaleRow } from '@/features/sales/sales.api'
import {
  useBuyer,
  useBuyerSummary,
  useFormatDate,
  useFormatNumber,
  useSalesError,
} from '@/features/sales/sales.hooks'

/**
 * One buyer, and everything the cooperative has sold them.
 *
 * The history needs a sales permission of its own, so somebody who may keep the buyer list but not
 * see the sales gets the details and is told plainly that the history is withheld — rather than an
 * empty table, which would read as a buyer who has never bought anything.
 */

const STATUS_TONE: Readonly<Record<string, BadgeTone>> = {
  DRAFT: 'warning',
  CONFIRMED: 'success',
  CANCELLED: 'neutral',
}

export function BuyerProfilePage() {
  const { t } = useTranslation(['sales', 'common'])
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const describeError = useSalesError()
  const formatDate = useFormatDate()
  const formatNumber = useFormatNumber()

  const canManage = usePermission('buyers:manage')
  const canSeeSales = usePermission('sales:view')
  const canRecordSale = usePermission('sales:create')

  const buyer = useBuyer(id)
  const summary = useBuyerSummary(id, canSeeSales)

  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  if (buyer.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (buyer.isError || !buyer.data) {
    return <Alert tone="danger">{t('sales:buyerProfile.loadFailed')}</Alert>
  }

  const row = buyer.data
  const sales = summary.data?.sales ?? []

  const columns: Column<SaleRow>[] = [
    {
      key: 'reference',
      header: t('sales:saleColumns.reference'),
      render: (sale) => <span className="text-sm text-ink-muted">{sale.reference}</span>,
    },
    {
      key: 'date',
      header: t('sales:saleColumns.date'),
      render: (sale) => formatDate(sale.saleDate),
    },
    {
      key: 'status',
      header: t('sales:saleColumns.status'),
      render: (sale) => (
        <Badge tone={STATUS_TONE[sale.status] ?? 'neutral'}>
          {t(`sales:status.${sale.status}`, { defaultValue: sale.status })}
        </Badge>
      ),
    },
    {
      key: 'total',
      header: t('sales:saleColumns.total'),
      align: 'right',
      render: (sale) => <Money value={sale.total} />,
    },
    {
      key: 'outstanding',
      header: t('sales:saleColumns.outstanding'),
      align: 'right',
      render: (sale) => (
        <Money value={sale.outstanding} tone={sale.outstanding === '0.00' ? 'neutral' : 'out'} />
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={row.name}
        description={row.organization ?? undefined}
        actions={
          <>
            <Button
              variant="secondary"
              asChild
              leadingIcon={<ArrowLeft aria-hidden="true" className="size-4" />}
            >
              <Link to="/buyers">{t('sales:buyerProfile.backToBuyers')}</Link>
            </Button>
            {canRecordSale && row.isActive ? (
              <Button
                leadingIcon={<Receipt aria-hidden="true" className="size-4" />}
                onClick={() => void navigate(`/sales/new?buyerId=${row.id}`)}
              >
                {t('sales:buyerProfile.recordSale')}
              </Button>
            ) : null}
            {canManage ? (
              <Button
                variant="secondary"
                leadingIcon={<Pencil aria-hidden="true" className="size-4" />}
                onClick={() => {
                  setNotice(null)
                  setEditing(true)
                }}
              >
                {t('sales:buyers.edit')}
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

      {/* A buyer out of use cannot be named on a new sale, so the screen says so rather than
          letting somebody find out at the point of saving. */}
      {row.isActive ? null : <Alert tone="warning">{t('sales:buyerProfile.outOfUse')}</Alert>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title={t('sales:buyerProfile.detailsTitle')}>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label={t('sales:buyerProfile.organization')} value={row.organization} />
            <Detail label={t('sales:buyerProfile.contactPerson')} value={row.contactPerson} />
            <Detail label={t('sales:buyerProfile.phone')} value={row.phone} />
            <Detail label={t('sales:buyerProfile.email')} value={row.email} />
            <Detail label={t('sales:buyerProfile.tin')} value={row.tin} />
            <Detail
              label={t('sales:buyerProfile.place')}
              value={[row.sector, row.district].filter(Boolean).join(', ') || null}
            />
            <Detail label={t('sales:buyerProfile.address')} value={row.address} />
            <Detail label={t('sales:buyerProfile.notes')} value={row.notes} />
          </dl>
        </Panel>

        <Panel
          title={t('sales:buyerProfile.totalsTitle')}
          description={t('sales:buyerProfile.totalsCover')}
        >
          <dl className="flex flex-col gap-2 text-sm">
            <Figure label={t('sales:buyerProfile.sold')} value={row.totalSold} strong />
            <Figure
              label={t('sales:buyerProfile.paid')}
              value={summary.data?.totals.paid ?? '0.00'}
            />
            <Figure label={t('sales:buyerProfile.outstanding')} value={row.outstanding} strong />
            <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
              <dt className="text-ink-muted">{t('sales:buyers.columns.sales')}</dt>
              <dd className="text-ink">{formatNumber(row.saleCount)}</dd>
            </div>
          </dl>
        </Panel>
      </div>

      <Panel flush title={t('sales:buyerProfile.historyTitle')}>
        {canSeeSales ? (
          <DataTable
            rows={sales}
            columns={columns}
            rowKey={(sale) => sale.id}
            caption={t('sales:buyerProfile.historyCaption')}
            loading={summary.isPending}
            rowMuted={(sale) => sale.status === 'CANCELLED'}
            onRowClick={(sale) => void navigate(`/sales/${sale.id}`)}
            empty={
              <EmptyState
                icon={Receipt}
                title={t('sales:buyerProfile.historyEmptyTitle')}
                description={t('sales:buyerProfile.historyEmptyBody')}
              />
            }
            mobileRow={(sale) => (
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">{sale.reference}</span>
                  <Money value={sale.total} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[sale.status] ?? 'neutral'}>
                    {t(`sales:status.${sale.status}`, { defaultValue: sale.status })}
                  </Badge>
                  <span className="text-sm text-ink-muted">{formatDate(sale.saleDate)}</span>
                </div>
              </div>
            )}
          />
        ) : (
          // Named rather than shown as an empty table, which would read as a buyer who has never
          // bought anything.
          <p className="px-4 py-4 text-sm text-ink-muted">
            {t('sales:buyerProfile.historyWithheld')}
          </p>
        )}
      </Panel>

      {summary.isError ? <Alert tone="danger">{describeError(summary.error).message}</Alert> : null}

      <BuyerDialog open={editing} onOpenChange={setEditing} buyer={row} onDone={setNotice} />
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string | null }) {
  const { t } = useTranslation('sales')
  return (
    <div>
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-base text-ink">
        {value ?? <span className="text-ink-muted">{t('buyerProfile.nothingRecorded')}</span>}
      </dd>
    </div>
  )
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={strong ? 'font-semibold text-ink' : 'text-ink'}>
        <Money value={value} />
      </dd>
    </div>
  )
}
