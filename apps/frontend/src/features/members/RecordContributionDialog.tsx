import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
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
import { currentLanguage } from '@/i18n'
import {
  CONTRIBUTION_TYPES,
  PAYMENT_METHODS,
  type ContributionInput,
  type ContributionType,
  type PaymentMethod,
} from './members.api'
import {
  todayIso,
  useMemberError,
  useMemberFormOptions,
  useRecordContribution,
} from './members.hooks'

/**
 * Recording money a member has paid to the cooperative.
 *
 * **The amount is a string from the first keystroke to the wire.** It is never put through
 * `Number` or `parseFloat`: a float cannot hold a decimal amount exactly, and an amount that
 * arrives a franc short is an amount the books cannot reconcile. The field collects digits, the
 * check is a regular expression over those digits, and the same characters are what the server
 * receives.
 *
 * The dialog restates the amount before it is recorded, which `docs/ui-system.md` section 8 asks
 * of every financial confirmation.
 */

/** Whole francs, or francs with up to two decimal places. Nothing else is money. */
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const schema = z.object({
  type: z.string().refine((value) => CONTRIBUTION_TYPES.some((item) => item === value)),
  amount: z
    .string()
    .trim()
    .refine((value) => AMOUNT.test(value) && /[1-9]/.test(value)),
  paidOn: z.string().refine((value) => value === '' || DATE_ONLY.test(value)),
  method: z.string().refine((value) => PAYMENT_METHODS.some((item) => item === value)),
  categoryId: z.string().min(1),
  reference: z.string().trim().max(60),
  note: z.string().trim().max(280),
})

type FormValues = z.infer<typeof schema>

function emptyValues(): FormValues {
  return {
    type: '',
    amount: '',
    paidOn: todayIso(),
    // Cash is how a cooperative in a rural district is paid nine times in ten.
    method: 'CASH',
    categoryId: '',
    reference: '',
    note: '',
  }
}

export interface RecordContributionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: { id: string; fullName: string; memberCode: string }
  onRecorded?: (result: { amount: string; reference: string }) => void
}

export function RecordContributionDialog({
  open,
  onOpenChange,
  member,
  onRecorded,
}: RecordContributionDialogProps) {
  const { t } = useTranslation(['members', 'common'])
  const describeError = useMemberError()
  const options = useMemberFormOptions(open)
  const record = useRecordContribution()
  const language = currentLanguage()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyValues(),
    mode: 'onBlur',
  })
  const { register, handleSubmit, reset, formState, control } = form

  /**
   * Each opening starts from a clean sheet. Nothing local is set here: the failure is read from
   * the mutation rather than copied into state, so this effect synchronises rather than cascades.
   */
  useEffect(() => {
    if (!open) return
    reset(emptyValues())
    record.reset()
    // The mutation object is rebuilt on every state change of its own, so depending on it would
    // clear the failure the moment it appeared. Its `reset` function is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset])

  const type = useWatch({ control, name: 'type' })
  const method = useWatch({ control, name: 'method' })
  const categoryId = useWatch({ control, name: 'categoryId' })
  const amount = useWatch({ control, name: 'amount' })

  const categories = options.data?.incomeCategories ?? []
  const noCategories = options.isSuccess && categories.length === 0

  const failed = record.error
  const described = failed ? describeError(failed) : null
  const serverFields = described?.fieldErrors ?? {}

  const submit = handleSubmit((values) => {
    const body: ContributionInput = {
      type: values.type as ContributionType,
      // The string the user typed, unchanged.
      amount: values.amount.trim(),
      method: values.method as PaymentMethod,
      categoryId: values.categoryId,
      ...(values.paidOn ? { paidOn: values.paidOn } : {}),
      ...(values.reference ? { reference: values.reference } : {}),
      ...(values.note ? { note: values.note } : {}),
    }
    record.mutate(
      { memberId: member.id, contribution: body },
      {
        onSuccess: (result) => {
          onRecorded?.({ amount: result.amount, reference: result.reference })
          onOpenChange(false)
        },
      },
    )
  })

  function errorFor(field: keyof FormValues): string | undefined {
    if (formState.errors[field]) return t(`members:contributionErrors.${field}`)
    return serverFields[field]
  }

  const typeOptions: SelectOption[] = CONTRIBUTION_TYPES.map((value) => ({
    value,
    label: t(`members:contributions.type.${value}`),
  }))

  const methodOptions: SelectOption[] = PAYMENT_METHODS.map((value) => ({
    value,
    label: t(`members:method.${value}`),
  }))

  const categoryOptions: SelectOption[] = categories.map((category) => ({
    value: category.id,
    label: language === 'rw' ? (category.nameRw ?? category.name) : category.name,
  }))

  const restatable = typeof amount === 'string' && AMOUNT.test(amount.trim())

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="md"
      busy={record.isPending}
      title={t('members:contributionDialog.title')}
      description={t('members:contributionDialog.description', {
        name: member.fullName,
        code: member.memberCode,
      })}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={record.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            type="submit"
            form="record-contribution-form"
            loading={record.isPending}
            disabled={noCategories}
          >
            {t('members:contributionDialog.submit')}
          </Button>
        </>
      }
    >
      <form
        id="record-contribution-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => void submit(event)}
      >
        {described ? <Alert tone="danger">{described.message}</Alert> : null}
        {noCategories ? (
          <Alert tone="warning">{t('members:contributionDialog.noCategories')}</Alert>
        ) : null}

        <FormField label={t('members:contributionFields.type')} error={errorFor('type')}>
          <Select
            options={typeOptions}
            placeholder={t('members:contributionFields.typePlaceholder')}
            value={type ?? ''}
            {...register('type')}
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('members:contributionFields.amount')}
            hint={t('members:contributionFields.amountHint')}
            error={errorFor('amount')}
          >
            {/* `inputMode` rather than `type="number"`: a number input rounds, spins and localises
                the decimal separator, none of which an amount can survive. */}
            <Input inputMode="decimal" autoComplete="off" {...register('amount')} />
          </FormField>

          <FormField label={t('members:contributionFields.paidOn')} error={errorFor('paidOn')}>
            <Input type="date" {...register('paidOn')} />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('members:contributionFields.method')} error={errorFor('method')}>
            <Select options={methodOptions} value={method ?? 'CASH'} {...register('method')} />
          </FormField>

          <FormField
            label={t('members:contributionFields.category')}
            error={errorFor('categoryId')}
          >
            <Select
              options={categoryOptions}
              placeholder={t('members:contributionFields.categoryPlaceholder')}
              value={categoryId ?? ''}
              {...register('categoryId')}
            />
          </FormField>
        </div>

        <FormField
          label={t('members:contributionFields.reference')}
          optional
          error={errorFor('reference')}
        >
          <Input autoComplete="off" {...register('reference')} />
        </FormField>

        <FormField label={t('members:contributionFields.note')} optional error={errorFor('note')}>
          <Textarea rows={2} {...register('note')} />
        </FormField>

        {/*
          The amount is restated before it is recorded, which section 8 of the design system asks
          of every financial confirmation. The figure is interpolated into one sentence rather
          than assembled from fragments around a component, because Kinyarwanda noun classes make
          a sentence built from pieces grammatically wrong. `formatMoney` is what the `Money`
          component itself uses, and works on the string without parsing it into a number.
        */}
        {restatable ? (
          <p className="rounded-md border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-secondary">
            {t('members:contributionDialog.restate', {
              amount: formatMoney(amount.trim()),
              name: member.fullName,
            })}
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}
