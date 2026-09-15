import { ArrowLeft, Printer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { formatMoney } from '@coopmanage/shared'
import { Alert, Button, Skeleton } from '@/components/ui'
import { useFormatDate, useFormatDateTime, useSaleReceipt } from '@/features/sales/sales.hooks'

/**
 * The receipt, for paper.
 *
 * A Rwandan cooperative's dealings with a buyer end up in a file, so this is designed for A4 first
 * and for the screen second. `docs/ui-system.md` section 11 sets the rules and they are followed
 * here: the application shell is removed, the text is black on white, the status is words rather
 * than a coloured badge, and the footer names the cooperative, the document, the sale and who
 * produced it.
 *
 * The figures are printed exactly as the server sent them. `formatMoney` works on the decimal
 * string without parsing it into a number, so nothing in the printing path can arrive at a
 * different total from the one in the books — which is the only reason a buyer can be handed this
 * and told it is what the cooperative's records say.
 */
export function SaleReceiptPage() {
  const { t } = useTranslation(['sales', 'common'])
  const { id } = useParams<{ id: string }>()
  const receipt = useSaleReceipt(id)
  const formatDate = useFormatDate()
  const formatDateTime = useFormatDateTime()

  if (receipt.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (receipt.isError || !receipt.data) {
    return <Alert tone="danger">{t('sales:receipt.loadFailed')}</Alert>
  }

  const { sale, cooperative, buyer, issuedAt, issuedBy } = receipt.data

  return (
    <div className="flex flex-col gap-4">
      {/*
        The only two controls, and neither of them prints. `print:hidden` is what turns this from a
        screen with a receipt on it into a receipt.
      */}
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button
          variant="secondary"
          asChild
          leadingIcon={<ArrowLeft aria-hidden="true" className="size-4" />}
        >
          <Link to={`/sales/${sale.id}`}>{t('sales:receipt.backToSale')}</Link>
        </Button>
        <Button
          leadingIcon={<Printer aria-hidden="true" className="size-4" />}
          onClick={() => window.print()}
        >
          {t('sales:receipt.print')}
        </Button>
      </div>

      {sale.status === 'DRAFT' ? (
        <Alert tone="warning">{t('sales:receipt.draftWarning')}</Alert>
      ) : null}
      {sale.status === 'CANCELLED' ? (
        <Alert tone="warning">
          {t('sales:receipt.cancelledWarning', {
            when: sale.cancelledAt ? formatDateTime(sale.cancelledAt) : '',
          })}
        </Alert>
      ) : null}

      <article className="mx-auto w-full max-w-[210mm] bg-surface p-6 text-ink print:max-w-none print:bg-white print:p-0 print:text-black">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4 print:border-black">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{cooperative.name}</h1>
            <p className="mt-0.5 text-sm text-ink-muted print:text-black">
              {t('sales:receipt.cooperativePlace', {
                district: cooperative.district,
                sector: cooperative.sector,
              })}
            </p>
            <p className="text-sm text-ink-muted print:text-black">
              {t('sales:receipt.cooperativeCode', { code: cooperative.code })}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold uppercase tracking-wide">
              {t('sales:receipt.documentTitle')}
            </p>
            <p className="text-sm">{sale.reference}</p>
            <p className="text-sm text-ink-muted print:text-black">{formatDate(sale.saleDate)}</p>
          </div>
        </header>

        <div className="grid gap-4 border-b border-line py-4 sm:grid-cols-2 print:border-black">
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted print:text-black">
              {t('sales:receipt.buyerHeading')}
            </h2>
            <p className="mt-1 text-base font-medium">{buyer.name}</p>
            {buyer.organization ? <p className="text-sm">{buyer.organization}</p> : null}
            {buyer.contactPerson ? <p className="text-sm">{buyer.contactPerson}</p> : null}
            {buyer.phone ? <p className="text-sm">{buyer.phone}</p> : null}
            {buyer.tin ? <p className="text-sm">{buyer.tin}</p> : null}
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted print:text-black">
              {t('sales:receipt.saleHeading')}
            </h2>
            <dl className="mt-1 flex flex-col gap-0.5 text-sm">
              <Row label={t('sales:receipt.warehouse')} value={sale.warehouseName} />
              {/*
                Words rather than a badge, because a coloured pill carries nothing on paper and a
                photocopy carries less.
              */}
              <Row
                label={t('sales:receipt.status')}
                value={t(`sales:status.${sale.status}`, { defaultValue: sale.status })}
              />
              <Row
                label={t('sales:receipt.paymentStatus')}
                value={t(`sales:paymentStatus.${sale.paymentStatus}`, {
                  defaultValue: sale.paymentStatus,
                })}
              />
            </dl>
          </section>
        </div>

        <table className="mt-4 w-full border-collapse text-sm">
          <caption className="sr-only">{t('sales:receipt.linesCaption')}</caption>
          {/* `table-header-group` is what repeats the header across pages when the lines run on. */}
          <thead className="print:table-header-group">
            <tr className="border-b border-line text-left print:border-black">
              <th scope="col" className="py-1.5 pr-2 font-semibold">
                {t('sales:receipt.columns.position')}
              </th>
              <th scope="col" className="py-1.5 pr-2 font-semibold">
                {t('sales:receipt.columns.product')}
              </th>
              <th scope="col" className="py-1.5 pr-2 text-right font-semibold">
                {t('sales:receipt.columns.quantity')}
              </th>
              <th scope="col" className="py-1.5 pr-2 text-right font-semibold">
                {t('sales:receipt.columns.unitPrice')}
              </th>
              <th scope="col" className="py-1.5 text-right font-semibold">
                {t('sales:receipt.columns.lineTotal')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((line, index) => (
              <tr key={line.id} className="border-b border-line print:border-black">
                <td className="py-1.5 pr-2 tabular-nums">{index + 1}</td>
                <td className="py-1.5 pr-2">
                  {line.productName}
                  <span className="block text-xs text-ink-muted print:text-black">{line.sku}</span>
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {line.quantity} {line.unitSymbol}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {formatMoney(line.unitPrice, { withCurrency: false })}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatMoney(line.lineTotal, { withCurrency: false })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <dl className="w-full max-w-xs flex-col gap-1 text-sm">
            <Row label={t('sales:receipt.subtotal')} value={formatMoney(sale.subtotal)} />
            <Row label={t('sales:receipt.discount')} value={formatMoney(sale.discount)} />
            <Row label={t('sales:receipt.tax')} value={formatMoney(sale.taxAmount)} />
            <div className="border-t border-line pt-1 print:border-black">
              <Row label={t('sales:receipt.total')} value={formatMoney(sale.total)} strong />
            </div>
            <Row label={t('sales:receipt.amountPaid')} value={formatMoney(sale.amountPaid)} />
            <Row
              label={t('sales:receipt.outstanding')}
              value={formatMoney(sale.outstanding)}
              strong
            />
          </dl>
        </div>

        <section className="mt-4 border-t border-line pt-3 text-sm print:border-black">
          <h2 className="font-semibold">{t('sales:receipt.paymentsHeading')}</h2>
          {sale.payments.length === 0 ? (
            <p className="mt-1 text-ink-muted print:text-black">{t('sales:receipt.noPayments')}</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {sale.payments.map((payment) => (
                <li key={payment.id} className="flex justify-between gap-3">
                  <span>
                    {formatDate(payment.occurredAt)} ·{' '}
                    {t(`sales:method.${payment.method}`, { defaultValue: payment.method })} ·{' '}
                    {payment.reference}
                  </span>
                  <span className="tabular-nums">{formatMoney(payment.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-6 flex flex-wrap items-end justify-between gap-2 border-t border-line pt-3 text-xs text-ink-muted print:border-black print:text-black">
          <div>
            <p>{t('sales:receipt.issuedBy', { name: issuedBy })}</p>
            <p>{t('sales:receipt.issuedAt', { when: formatDateTime(issuedAt) })}</p>
          </div>
          <p>
            {t('sales:receipt.footer', {
              cooperative: cooperative.name,
              document: t('sales:receipt.documentTitle'),
              reference: sale.reference,
            })}
          </p>
        </footer>
      </article>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? 'font-semibold' : ''}>{label}</dt>
      <dd className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>{value}</dd>
    </div>
  )
}
