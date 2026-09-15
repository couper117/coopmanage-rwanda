import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { formatMoney } from '@coopmanage/shared'
import { Alert, Button, Dialog, FormField, Input, Select, type SelectOption } from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { useFinanceCategories } from '@/features/finance/finance.hooks'
import {
  isMoney,
  isZeroMoney,
  PAYMENT_METHODS,
  type ConfirmSaleInput,
  type PaymentMethod,
  type SaleDetail,
} from './sales.api'
import {
  isInsufficientStock,
  useConfirmSale,
  useSalesError,
  useSalesFieldError,
} from './sales.hooks'

/**
 * Confirming a sale, and taking payment for it in the same act.
 *
 * **Confirmation is the one act that makes a sale real.** The stock comes out, a movement is
 * written for every line, any payment is posted into the books and the sale is marked, all inside
 * one transaction. So the dialog restates what is about to happen in a sentence before the button
 * that does it, and says plainly that it cannot be undone: a confirmed sale is cancelled, which
 * writes compensating entries rather than deleting anything.
 *
 * **Payment at the same time is the common case at a counter.** The amount is optional and the
 * income category is required the moment an amount is given, because money landing in the books
 * has to say where. Somebody who cannot read the income categories at all — an inventory officer
 * holds no finance permission — is told so and can still confirm the sale without payment.
 *
 * **An insufficient-stock refusal is reported as the state it leaves behind.** Because the whole
 * confirmation is one transaction, a store that cannot fill the sale leaves it exactly as it was:
 * still a draft, with nothing moved and no money recorded. The dialog says that, and offers to
 * read the sale again rather than quoting back a stock figure the server deliberately did not
 * send — by the time a refusal is read the level may have moved again.
 *
 * The dismiss button says "Leave it as a draft" rather than the shared "Cancel". Cancelling is a
 * real thing that happens to a sale, and a control meaning "abandon this dialog" must not carry
 * the same word as one meaning "put the sale out of service".
 */

const schema = z
  .object({
    amountPaid: z
      .string()
      .trim()
      .refine((value) => value === '' || isMoney(value)),
    method: z.string(),
    incomeCategoryId: z.string(),
  })
  // The server requires a category whenever an amount is given. Saying so here means the reader is
  // told which field to fill in rather than handed a refusal about the whole request.
  .refine(
    (values) =>
      values.amountPaid === '' || isZeroMoney(values.amountPaid) || values.incomeCategoryId !== '',
    { path: ['incomeCategoryId'] },
  )

type FormValues = z.infer<typeof schema>

export interface ConfirmSaleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sale: SaleDetail
  /** A finished sentence about what was recorded, for the screen to show above the sale. */
  onDone?: (notice: string) => void
  /** Reads the sale again, for the one refusal that means the quantities have moved on. */
  onReload?: () => void
}

export function ConfirmSaleDialog({
  open,
  onOpenChange,
  sale,
  onDone,
  onReload,
}: ConfirmSaleDialogProps) {
  const { t } = useTranslation(['sales', 'common'])
  const describeError = useSalesError()
  const fieldError = useSalesFieldError()
  const confirm = useConfirmSale()

  /**
   * Whether the money can be posted at all. Reading the income categories needs `finance:view`,
   * which an inventory officer does not hold, so for them the whole section is absent rather than
   * present and broken, and the list is never asked for.
   */
  const canTakePayment = usePermission('finance:view')
  const categories = useFinanceCategories({
    kind: 'INCOME',
    enabled: open && canTakePayment,
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      amountPaid: '',
      // Cash is how a cooperative in a rural district is paid, nine times in ten.
      method: 'CASH',
      incomeCategoryId: '',
    },
    mode: 'onBlur',
  })
  const { register, handleSubmit, formState, control } = form
  const amountPaid = useWatch({ control, name: 'amountPaid' })

  const failed = confirm.error
  const described = failed ? describeError(failed) : null
  const serverFields = described?.fieldErrors ?? {}
  const shortOfStock = isInsufficientStock(failed)

  const submit = handleSubmit((values) => {
    const amount = values.amountPaid.trim()
    const takingPayment = canTakePayment && amount !== '' && !isZeroMoney(amount)

    const body: ConfirmSaleInput = takingPayment
      ? {
          // The characters the user typed, unchanged, and the category alongside them because the
          // server will not record money that does not say where it goes.
          amountPaid: amount,
          method: readPaymentMethod(values.method),
          incomeCategoryId: values.incomeCategoryId,
        }
      : {}

    confirm.mutate(
      { id: sale.id, body },
      {
        onSuccess: (result) => {
          onDone?.(
            t('sales:confirmDialog.done', {
              reference: result.reference,
              warehouse: result.warehouseName,
            }),
          )
          onOpenChange(false)
        },
      },
    )
  })

  const methodOptions: SelectOption[] = PAYMENT_METHODS.map((value) => ({
    value,
    label: t(`sales:method.${value}`),
  }))

  const categoryOptions: SelectOption[] = (categories.data ?? [])
    .filter((row) => row.isActive)
    .map((row) => ({ value: row.id, label: row.name }))

  const amountGiven =
    typeof amountPaid === 'string' && amountPaid.trim() !== '' && !isZeroMoney(amountPaid.trim())

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="md"
      busy={confirm.isPending}
      title={t('sales:confirmDialog.title')}
      description={t('sales:confirmDialog.description')}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={confirm.isPending}
            onClick={() => onOpenChange(false)}
          >
            {/* Never the shared "Cancel": cancelling is a real thing that happens to a sale, and
                a control meaning "abandon this dialog" must not carry the same word. */}
            {t('sales:confirmDialog.dismiss')}
          </Button>
          <Button type="submit" form="confirm-sale-form" loading={confirm.isPending}>
            {t('sales:confirmDialog.submit')}
          </Button>
        </>
      }
    >
      <form
        id="confirm-sale-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => void submit(event)}
      >
        {/*
          The one refusal the screen reacts to rather than merely reports. It says what state the
          sale is in — still a draft, nothing moved — because that is the question somebody who has
          just been refused actually has.
        */}
        {shortOfStock ? (
          <Alert
            tone="warning"
            title={t('sales:confirmDialog.insufficientTitle')}
            action={
              onReload ? (
                <Button variant="secondary" size="sm" onClick={onReload}>
                  {t('sales:confirmDialog.reload')}
                </Button>
              ) : undefined
            }
          >
            {t('sales:confirmDialog.insufficientBody')}
          </Alert>
        ) : described ? (
          <Alert tone="danger">{described.message}</Alert>
        ) : null}

        {/*
          What is about to happen, in one sentence with its figures interpolated into it. A single
          key rather than fragments around a component, because Kinyarwanda noun classes make a
          sentence built from pieces grammatically wrong.
        */}
        <p className="rounded-md border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-secondary">
          {sale.lines.length === 1
            ? t('sales:confirmDialog.restateOneLine', {
                warehouse: sale.warehouseName,
                buyer: sale.buyerName,
                total: formatMoney(sale.total),
              })
            : t('sales:confirmDialog.restate', {
                lines: sale.lines.length,
                warehouse: sale.warehouseName,
                buyer: sale.buyerName,
                total: formatMoney(sale.total),
              })}
        </p>

        {canTakePayment ? (
          <div className="flex flex-col gap-3 rounded-md border border-line px-3 py-3">
            <p className="text-sm text-ink-secondary">{t('sales:confirmDialog.paymentIntro')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label={t('sales:confirmDialog.amountPaid')}
                optional
                hint={t('sales:confirmDialog.amountPaidHint')}
                error={
                  formState.errors.amountPaid
                    ? t('sales:confirmErrors.amountPaid')
                    : fieldError(serverFields, 'amountPaid')
                }
              >
                <Input inputMode="decimal" autoComplete="off" {...register('amountPaid')} />
              </FormField>

              <FormField label={t('sales:confirmDialog.method')} error={serverFields.method}>
                <Select options={methodOptions} disabled={!amountGiven} {...register('method')} />
              </FormField>
            </div>

            <FormField
              label={t('sales:confirmDialog.incomeCategory')}
              optional={!amountGiven}
              error={
                formState.errors.incomeCategoryId
                  ? t('sales:confirmErrors.incomeCategory')
                  : fieldError(serverFields, 'incomeCategoryId')
              }
            >
              <Select
                options={categoryOptions}
                placeholder={t('sales:confirmDialog.incomeCategoryPlaceholder')}
                disabled={!amountGiven}
                {...register('incomeCategoryId')}
              />
            </FormField>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">{t('sales:confirmDialog.noPaymentFields')}</p>
        )}
      </form>
    </Dialog>
  )
}

/**
 * The select hands back a plain string. Narrowing it against the methods the server accepts means
 * a tampered option cannot travel any further than here, and cash is the sensible fallback.
 */
function readPaymentMethod(value: string): PaymentMethod {
  return PAYMENT_METHODS.find((candidate) => candidate === value) ?? 'CASH'
}
