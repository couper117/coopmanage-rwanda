import { ArrowLeft, Ban, CheckCircle2, Coins, Pencil, Printer, Truck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  Money,
  Panel,
  Quantity,
  Skeleton,
  Textarea,
  type BadgeTone,
  type Column,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { ConfirmSaleDialog } from '@/features/sales/ConfirmSaleDialog'
import { RecordPaymentDialog } from '@/features/sales/RecordPaymentDialog'
import type { SaleMovementRow, SaleLineRow, SalePaymentRow } from '@/features/sales/sales.api'
import {
  useCancelSale,
  useFormatDate,
  useFormatDateTime,
  useSale,
  useSalesError,
} from '@/features/sales/sales.hooks'

/**
 * One sale, and the actions that apply to the state it is in.
 *
 * The state is the organising idea rather than a field on a form. A draft can be changed and
 * confirmed; a confirmed sale can take a payment and be cancelled; a cancelled one can only be
 * read, and says why. Offering a control that the state or the permission forbids would be a
 * promise the server is about to break, so each one appears only when it applies — and the server
 * checks again regardless of what the interface chose to show.
 */

const STATUS_TONE: Readonly<Record<string, BadgeTone>> = {
  DRAFT: 'warning',
  CONFIRMED: 'success',
  CANCELLED: 'neutral',
}

const PAYMENT_TONE: Readonly<Record<string, BadgeTone>> = {
  UNPAID: 'warning',
  PARTIAL: 'info',
  PAID: 'success',
}

export function SaleDetailPage() {
  const { t } = useTranslation(['sales', 'common'])
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const describeError = useSalesError()
  const formatDate = useFormatDate()
  const formatDateTime = useFormatDateTime()

  const canEdit = usePermission('sales:create')
  const canConfirm = usePermission('sales:confirm')
  const canCancel = usePermission('sales:cancel')
  const canRecordPayment = usePermission('finance:create')

  const sale = useSale(id)
  const cancel = useCancelSale()

  const [confirming, setConfirming] = useState(false)
  const [paying, setPaying] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (sale.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (sale.isError || !sale.data) {
    return <Alert tone="danger">{t('sales:detail.loadFailed')}</Alert>
  }

  const row = sale.data
  const isDraft = row.status === 'DRAFT'
  const isConfirmed = row.status === 'CONFIRMED'
  const isCancelled = row.status === 'CANCELLED'

  const lineColumns: Column<SaleLineRow>[] = [
    {
      key: 'product',
      header: t('sales:detail.lineColumns.product'),
      render: (line) => (
        <div className="min-w-0">
          <span className="block truncate font-medium text-ink">{line.productName}</span>
          <span className="block text-sm text-ink-muted">{line.sku}</span>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: t('sales:detail.lineColumns.quantity'),
      align: 'right',
      render: (line) => <Quantity value={line.quantity} unit={line.unitSymbol} />,
    },
    {
      key: 'unitPrice',
      header: t('sales:detail.lineColumns.unitPrice'),
      align: 'right',
      render: (line) => <Money value={line.unitPrice} />,
    },
    {
      key: 'lineTotal',
      header: t('sales:detail.lineColumns.lineTotal'),
      align: 'right',
      render: (line) => <Money value={line.lineTotal} />,
    },
  ]

  const paymentColumns: Column<SalePaymentRow>[] = [
    {
      key: 'reference',
      header: t('sales:detail.paymentColumns.reference'),
      render: (payment) => <span className="text-sm text-ink-muted">{payment.reference}</span>,
    },
    {
      key: 'date',
      header: t('sales:detail.paymentColumns.date'),
      render: (payment) => formatDate(payment.occurredAt),
    },
    {
      key: 'method',
      header: t('sales:detail.paymentColumns.method'),
      render: (payment) => t(`sales:method.${payment.method}`, { defaultValue: payment.method }),
    },
    {
      key: 'amount',
      header: t('sales:detail.paymentColumns.amount'),
      align: 'right',
      render: (payment) => <Money value={payment.amount} tone="in" />,
    },
  ]

  const movementColumns: Column<SaleMovementRow>[] = [
    {
      key: 'reference',
      header: t('sales:detail.movementColumns.reference'),
      render: (movement) => <span className="text-sm text-ink-muted">{movement.reference}</span>,
    },
    {
      key: 'product',
      header: t('sales:detail.movementColumns.product'),
      render: (movement) => movement.productName,
    },
    {
      key: 'quantity',
      header: t('sales:detail.movementColumns.quantity'),
      align: 'right',
      render: (movement) => <Quantity value={movement.quantity} />,
    },
  ]

  function submitCancel() {
    const trimmed = reason.trim()
    if (trimmed.length === 0) {
      setReasonError(t('sales:cancelDialog.reasonError'))
      return
    }
    cancel.mutate(
      { id: row.id, reason: trimmed },
      {
        onSuccess: () => {
          setNotice(t('sales:cancelDialog.done', { reference: row.reference }))
          setCancelling(false)
          setReason('')
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('sales:detail.title', { reference: row.reference })}
        description={
          isConfirmed && row.confirmedAt
            ? t('sales:detail.confirmedAt', { when: formatDateTime(row.confirmedAt) })
            : isCancelled && row.cancelledAt
              ? t('sales:detail.cancelledAt', { when: formatDateTime(row.cancelledAt) })
              : t('sales:detail.notConfirmed')
        }
        actions={
          <>
            <Button
              variant="secondary"
              asChild
              leadingIcon={<ArrowLeft aria-hidden="true" className="size-4" />}
            >
              <Link to="/sales">{t('sales:detail.backToSales')}</Link>
            </Button>
            <Button
              variant="secondary"
              asChild
              leadingIcon={<Printer aria-hidden="true" className="size-4" />}
            >
              <Link to={`/sales/${row.id}/receipt`}>{t('sales:detail.receipt')}</Link>
            </Button>
            {isDraft && canEdit ? (
              <Button
                variant="secondary"
                leadingIcon={<Pencil aria-hidden="true" className="size-4" />}
                onClick={() => void navigate(`/sales/${row.id}/edit`)}
              >
                {t('sales:detail.edit')}
              </Button>
            ) : null}
            {isDraft && canConfirm ? (
              <Button
                leadingIcon={<CheckCircle2 aria-hidden="true" className="size-4" />}
                onClick={() => {
                  setNotice(null)
                  setConfirming(true)
                }}
              >
                {t('sales:detail.confirm')}
              </Button>
            ) : null}
            {isConfirmed && canRecordPayment ? (
              <Button
                leadingIcon={<Coins aria-hidden="true" className="size-4" />}
                onClick={() => {
                  setNotice(null)
                  setPaying(true)
                }}
              >
                {t('sales:detail.recordPayment')}
              </Button>
            ) : null}
            {!isCancelled && canCancel ? (
              <Button
                variant="danger"
                leadingIcon={<Ban aria-hidden="true" className="size-4" />}
                onClick={() => {
                  setNotice(null)
                  setReason('')
                  setReasonError(null)
                  setCancelling(true)
                }}
              >
                {t('sales:detail.cancel')}
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

      {/* What the state means, in a sentence, because a badge alone does not say that nothing has
          left the store or that the income was reversed. */}
      {isDraft ? <Alert tone="info">{t('sales:detail.draftNotice')}</Alert> : null}
      {isCancelled ? (
        <Alert tone="warning" title={t('sales:detail.cancelledNotice')}>
          {row.cancelReason
            ? t('sales:detail.cancelReason', { reason: row.cancelReason })
            : undefined}
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <dl className="grid gap-4 px-4 py-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-ink-muted">{t('sales:detail.buyer')}</dt>
              <dd className="mt-0.5 text-base text-ink">
                <Link className="underline" to={`/buyers/${row.buyerId}`}>
                  {row.buyerName}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-muted">{t('sales:detail.saleDate')}</dt>
              <dd className="mt-0.5 text-base text-ink">{formatDate(row.saleDate)}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-muted">{t('sales:detail.warehouse')}</dt>
              <dd className="mt-0.5 text-base text-ink">{row.warehouseName}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-muted">{t('sales:saleColumns.status')}</dt>
              <dd className="mt-0.5 flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>
                  {t(`sales:status.${row.status}`, { defaultValue: row.status })}
                </Badge>
                <Badge tone={PAYMENT_TONE[row.paymentStatus] ?? 'neutral'}>
                  {t(`sales:paymentStatus.${row.paymentStatus}`, {
                    defaultValue: row.paymentStatus,
                  })}
                </Badge>
              </dd>
            </div>
            {row.note ? (
              <div className="sm:col-span-2">
                <dt className="text-sm text-ink-muted">{t('sales:detail.note')}</dt>
                <dd className="mt-0.5 text-base text-ink">{row.note}</dd>
              </div>
            ) : null}
          </dl>
        </Panel>

        <Panel title={t('sales:detail.totalsTitle')}>
          <dl className="flex flex-col gap-2 px-4 py-4 text-sm">
            <Figure label={t('sales:detail.subtotal')} value={row.subtotal} />
            <Figure label={t('sales:detail.discount')} value={row.discount} />
            <Figure label={t('sales:detail.tax')} value={row.taxAmount} />
            <div className="border-t border-line pt-2">
              <Figure label={t('sales:detail.total')} value={row.total} strong />
            </div>
            <Figure label={t('sales:detail.amountPaid')} value={row.amountPaid} />
            <Figure label={t('sales:detail.outstanding')} value={row.outstanding} strong />
          </dl>
        </Panel>
      </div>

      <Panel flush title={t('sales:detail.linesTitle')}>
        <DataTable
          rows={row.lines}
          columns={lineColumns}
          rowKey={(line) => line.id}
          caption={t('sales:detail.linesCaption')}
          mobileRow={(line) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">{line.productName}</span>
                <Money value={line.lineTotal} />
              </div>
              <p className="text-sm text-ink-muted">
                <Quantity value={line.quantity} unit={line.unitSymbol} />
                {' × '}
                <Money value={line.unitPrice} withCurrency={false} />
              </p>
            </div>
          )}
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel flush title={t('sales:detail.paymentsTitle')}>
          <DataTable
            rows={row.payments}
            columns={paymentColumns}
            rowKey={(payment) => payment.id}
            caption={t('sales:detail.paymentsCaption')}
            empty={
              <EmptyState
                icon={Coins}
                title={t('sales:detail.paymentsEmptyTitle')}
                description={t('sales:detail.paymentsEmptyBody')}
              />
            }
            mobileRow={(payment) => (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-ink-muted">{formatDate(payment.occurredAt)}</span>
                <Money value={payment.amount} tone="in" />
              </div>
            )}
          />
        </Panel>

        <Panel flush title={t('sales:detail.movementsTitle')}>
          <DataTable
            rows={row.movements}
            columns={movementColumns}
            rowKey={(movement) => movement.id}
            caption={t('sales:detail.movementsCaption')}
            empty={
              <EmptyState
                icon={Truck}
                title={t('sales:detail.movementsEmptyTitle')}
                description={t('sales:detail.movementsEmptyBody')}
              />
            }
            mobileRow={(movement) => (
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink">{movement.productName}</span>
                <Quantity value={movement.quantity} />
              </div>
            )}
          />
        </Panel>
      </div>

      <ConfirmSaleDialog
        open={confirming}
        onOpenChange={setConfirming}
        sale={row}
        onDone={setNotice}
        onReload={() => void sale.refetch()}
      />

      <RecordPaymentDialog open={paying} onOpenChange={setPaying} sale={row} onDone={setNotice} />

      {/*
        A plain dialog rather than `ConfirmDialog`, which takes no children: cancelling a sale has
        to carry a reason, and the reason is the thing that makes the cancellation auditable.
      */}
      <Dialog
        open={cancelling}
        onOpenChange={(open) => {
          if (!open) {
            setCancelling(false)
            setReason('')
            setReasonError(null)
          }
        }}
        title={t('sales:cancelDialog.title', { reference: row.reference })}
        busy={cancel.isPending}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={cancel.isPending}
              onClick={() => setCancelling(false)}
            >
              {/* Not the shared "Cancel", which here would sit beside "Cancel the sale" and mean
                  the opposite of it. */}
              {t('sales:cancelDialog.dismiss')}
            </Button>
            <Button variant="danger" loading={cancel.isPending} onClick={submitCancel}>
              {t('sales:cancelDialog.submit')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">
            {isConfirmed
              ? t('sales:cancelDialog.consequenceConfirmed')
              : t('sales:cancelDialog.consequenceDraft')}
          </p>
          <FormField
            label={t('sales:cancelDialog.reason')}
            hint={t('sales:cancelDialog.reasonHint')}
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
          {cancel.isError ? (
            <Alert tone="danger">{describeError(cancel.error).message}</Alert>
          ) : null}
        </div>
      </Dialog>
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
