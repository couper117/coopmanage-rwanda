import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { formatMoney } from '@coopmanage/shared'
import {
  Alert,
  Button,
  Dialog,
  FormField,
  Input,
  Select,
  Textarea,
  type SelectOption,
} from '@/components/ui'
import { useFinanceCategories } from '@/features/finance/finance.hooks'
import {
  compareMoney,
  isPositiveMoney,
  PAYMENT_METHODS,
  type PaymentMethod,
  type SaleDetail,
  type SalePaymentInput,
} from './sales.api'
import { todayIso, useRecordSalePayment, useSalesError, useSalesFieldError } from './sales.hooks'

/**
 * Money received against a confirmed sale.
 *
 * **The payment and the ledger entry are one act.** The server posts the income inside the same
 * transaction, which is why the income category is required rather than offered: money that lands
 * in the books has to say where. That is also why this dialog is behind `finance:create` and not
 * behind a sales permission — it writes into the cooperative's accounts.
 *
 * **More than what is owed is refused here, before anything is sent.** Taking more than the sale is
 * worth is a data-entry slip rather than a payment; change handed back over the counter is the
 * buyer's business and not something the books should carry. The server refuses it too, and the
 * refusal is reported against the amount field so the reader is told which figure to correct.
 *
 * The amount is a string from the first keystroke to the wire. It is never put through `Number`:
 * the comparison against what is owed is done on exact integer minor units, so a sale settled to
 * the franc is recorded as settled and not as a franc short.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const schema = z.object({
  amount: z.string().trim().refine(isPositiveMoney),
  method: z.string(),
  incomeCategoryId: z.string().min(1),
  paidOn: z.string().refine((value) => value === '' || DATE_ONLY.test(value)),
  note: z.string().trim().max(280),
})

type FormValues = z.infer<typeof schema>

export interface RecordPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sale: SaleDetail
  /** A finished sentence about what was recorded, for the screen to show above the sale. */
  onDone?: (notice: string) => void
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  sale,
  onDone,
}: RecordPaymentDialogProps) {
  const { t } = useTranslation(['sales', 'common'])
  const describeError = useSalesError()
  const fieldError = useSalesFieldError()
  const record = useRecordSalePayment()

  const categories = useFinanceCategories({ kind: 'INCOME', enabled: open })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: '',
      // Cash is how a cooperative in a rural district is paid, nine times in ten.
      method: 'CASH',
      incomeCategoryId: '',
      paidOn: todayIso(),
      note: '',
    },
    mode: 'onBlur',
  })
  const { register, handleSubmit, formState, control } = form
  const amount = useWatch({ control, name: 'amount' })

  const failed = record.error
  const described = failed ? describeError(failed) : null
  const serverFields = described?.fieldErrors ?? {}

  /**
   * Refused before any request, because the server's own refusal would tell the reader the same
   * thing a round-trip later. The comparison is over exact minor units and never over floats.
   */
  const tooMuch =
    typeof amount === 'string' &&
    isPositiveMoney(amount) &&
    compareMoney(amount.trim(), sale.outstanding) > 0

  const submit = handleSubmit((values) => {
    if (compareMoney(values.amount.trim(), sale.outstanding) > 0) return

    const body: SalePaymentInput = {
      // The characters the user typed, unchanged.
      amount: values.amount.trim(),
      method: readPaymentMethod(values.method),
      incomeCategoryId: values.incomeCategoryId,
      ...(values.paidOn ? { paidOn: values.paidOn } : {}),
      ...(values.note ? { note: values.note.trim() } : {}),
    }
    record.mutate(
      { id: sale.id, body },
      {
        onSuccess: () => {
          onDone?.(
            t('sales:paymentDialog.done', {
              amount: formatMoney(body.amount),
              reference: sale.reference,
            }),
          )
          onOpenChange(false)
        },
      },
    )
  })

  function amountError(): string | undefined {
    if (tooMuch) {
      return t('sales:paymentErrors.tooMuch', { outstanding: formatMoney(sale.outstanding) })
    }
    if (formState.errors.amount) return t('sales:paymentErrors.amount')
    return fieldError(serverFields, 'amount')
  }

  const methodOptions: SelectOption[] = PAYMENT_METHODS.map((value) => ({
    value,
    label: t(`sales:method.${value}`),
  }))

  const categoryOptions: SelectOption[] = (categories.data ?? [])
    .filter((row) => row.isActive)
    .map((row) => ({ value: row.id, label: row.name }))

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="md"
      busy={record.isPending}
      title={t('sales:paymentDialog.title')}
      description={t('sales:paymentDialog.description')}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={record.isPending}
            onClick={() => onOpenChange(false)}
          >
            {/* The shared "Cancel" is safe here: this abandons a form, it does not cancel a
                sale, so nothing meaning the opposite sits beside it. */}
            {t('common:actions.cancel')}
          </Button>
          <Button
            type="submit"
            form="sale-payment-form"
            loading={record.isPending}
            disabled={tooMuch}
          >
            {t('sales:paymentDialog.submit')}
          </Button>
        </>
      }
    >
      <form
        id="sale-payment-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => void submit(event)}
      >
        {described ? <Alert tone="danger">{described.message}</Alert> : null}

        {/*
          What is still owed, as one sentence with the figure interpolated into it. Assembled from
          a single key rather than from fragments around a component, because Kinyarwanda noun
          classes make a sentence built from pieces grammatically wrong.
        */}
        <p className="rounded-md border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-secondary">
          {t('sales:paymentDialog.outstanding', {
            amount: formatMoney(sale.outstanding),
            reference: sale.reference,
          })}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('sales:paymentDialog.amount')}
            hint={t('sales:paymentDialog.amountHint')}
            error={amountError()}
          >
            {/* `inputMode` rather than `type="number"`: a number input rounds, spins and
                localises the decimal separator, none of which an amount can survive. */}
            <Input inputMode="decimal" autoComplete="off" {...register('amount')} />
          </FormField>

          <FormField label={t('sales:paymentDialog.method')} error={serverFields.method}>
            <Select options={methodOptions} {...register('method')} />
          </FormField>

          <FormField
            label={t('sales:paymentDialog.incomeCategory')}
            error={
              formState.errors.incomeCategoryId
                ? t('sales:paymentErrors.incomeCategory')
                : fieldError(serverFields, 'incomeCategoryId')
            }
          >
            <Select
              options={categoryOptions}
              placeholder={t('sales:paymentDialog.incomeCategoryPlaceholder')}
              {...register('incomeCategoryId')}
            />
          </FormField>

          <FormField
            label={t('sales:paymentDialog.paidOn')}
            hint={t('sales:paymentDialog.paidOnHint')}
            error={formState.errors.paidOn ? t('sales:paymentErrors.paidOn') : serverFields.paidOn}
          >
            <Input type="date" {...register('paidOn')} />
          </FormField>
        </div>

        <FormField
          label={t('sales:paymentDialog.note')}
          optional
          hint={t('sales:paymentDialog.noteHint')}
          error={formState.errors.note ? t('sales:paymentErrors.note') : serverFields.note}
        >
          <Textarea rows={2} {...register('note')} />
        </FormField>
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
