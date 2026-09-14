import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
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
  SearchSelect,
  Select,
  Textarea,
  type SearchOption,
  type SelectOption,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { useMemberLookup } from '@/features/members/members.hooks'
import {
  PAYMENT_METHODS,
  type FinanceKind,
  type PaymentMethod,
  type TransactionInput,
} from './finance.api'
import {
  todayIso,
  useCategoryLabel,
  useFinanceCategories,
  useFinanceError,
  useRecordTransaction,
} from './finance.hooks'

/**
 * Recording one movement of money, in or out.
 *
 * **The kind is a prop, not a field.** The ledger offers two separate actions — money in and
 * money out — so the reader has already said which one they mean before the dialog opens, and the
 * dialog's title, its category list and its closing sentence all follow from that. A single
 * dialog with an income-or-expense toggle is how somebody records a payment as a receipt.
 *
 * **The amount is a string from the first keystroke to the wire.** It is never put through
 * `Number` or `parseFloat`: a float cannot hold a decimal amount exactly, and an amount that
 * arrives a franc short is an amount the books cannot reconcile. The field collects digits, the
 * check is a regular expression over those digits, and the same characters are what the server
 * receives.
 *
 * The dialog restates what is about to be recorded before the submit button, which
 * `docs/ui-system.md` section 8 asks of every financial confirmation.
 */

/** Whole francs, or francs with up to two decimal places. Nothing else is money. */
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const schema = z.object({
  categoryId: z.string().min(1),
  amount: z
    .string()
    .trim()
    // The digit check is what refuses a zero, and with it every negative: the sign is carried by
    // the kind, so there is no such thing here as an amount below nothing.
    .refine((value) => AMOUNT.test(value) && /[1-9]/.test(value)),
  occurredAt: z.string().refine((value) => value === '' || DATE_ONLY.test(value)),
  method: z.string().refine((value) => PAYMENT_METHODS.some((item) => item === value)),
  description: z.string().trim().min(1).max(280),
})

type FormValues = z.infer<typeof schema>

function emptyValues(): FormValues {
  return {
    categoryId: '',
    amount: '',
    occurredAt: todayIso(),
    // Cash is how a cooperative in a rural district is paid, and pays, nine times in ten.
    method: 'CASH',
    description: '',
  }
}

export interface RecordEntryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Which side of the books this entry falls on. Chosen before the dialog opened. */
  kind: FinanceKind
  onRecorded?: (result: { amount: string; reference: string }) => void
}

export function RecordEntryDialog({
  open,
  onOpenChange,
  kind,
  onRecorded,
}: RecordEntryDialogProps) {
  const { t } = useTranslation(['finance', 'members', 'common'])
  const describeError = useFinanceError()
  const categoryLabel = useCategoryLabel()
  // Only the active categories of this kind: an entry must never be posted to a category the
  // cooperative has retired, or to one on the other side of the balance.
  const categories = useFinanceCategories({ kind, enabled: open })
  const record = useRecordTransaction()

  /**
   * Which member the money concerns, if any. Held here rather than in the form because it is a
   * chosen object rather than typed text, and because naming a member is optional in a way none
   * of the form's fields are: most entries in a cooperative's books concern nobody in particular.
   *
   * Offered only to somebody who may read the register, since finding a member means searching
   * it. An accountant holds both permissions; the server checks the member belongs to this
   * cooperative whatever the interface sent.
   */
  const canSearchMembers = usePermission('members:view')
  const [member, setMember] = useState<SearchOption | null>(null)
  const [memberQuery, setMemberQuery] = useState('')
  const lookup = useMemberLookup(memberQuery, open && canSearchMembers)

  /**
   * Closing the dialog forgets the member, and every way of closing it comes through here: the
   * footer button, the close control, Escape and the scrim. Clearing on the way out rather than
   * on the way back in keeps it out of an effect, and means the dialog is not holding a reference
   * to a person after the reader has dismissed it.
   */
  function setOpen(next: boolean) {
    if (!next) {
      setMember(null)
      setMemberQuery('')
    }
    onOpenChange(next)
  }

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
  }, [open, kind, reset])

  const categoryId = useWatch({ control, name: 'categoryId' })
  const method = useWatch({ control, name: 'method' })
  const amount = useWatch({ control, name: 'amount' })

  const rows = categories.data ?? []
  const noCategories = categories.isSuccess && rows.length === 0

  const failed = record.error
  const described = failed ? describeError(failed) : null
  const serverFields = described?.fieldErrors ?? {}

  const submit = handleSubmit((values) => {
    const body: TransactionInput = {
      kind,
      categoryId: values.categoryId,
      // The string the user typed, unchanged.
      amount: values.amount.trim(),
      method: values.method as PaymentMethod,
      description: values.description.trim(),
      ...(values.occurredAt ? { occurredAt: values.occurredAt } : {}),
      ...(member ? { memberId: member.value } : {}),
    }
    record.mutate(body, {
      onSuccess: (result) => {
        onRecorded?.({ amount: result.amount, reference: result.reference })
        setOpen(false)
      },
    })
  })

  function errorFor(field: keyof FormValues): string | undefined {
    if (formState.errors[field]) return t(`finance:entryErrors.${field}`)
    return serverFields[field]
  }

  const methodOptions: SelectOption[] = PAYMENT_METHODS.map((value) => ({
    value,
    label: t(`finance:method.${value}`),
  }))

  const categoryOptions: SelectOption[] = rows.map((category) => ({
    value: category.id,
    label: categoryLabel(category),
  }))

  /** The member code goes in the hint, because two people in a cooperative share a name often. */
  const memberOptions: SearchOption[] = (lookup.data?.items ?? []).map((row) => ({
    value: row.id,
    label: row.fullName,
    hint:
      row.status === 'ACTIVE'
        ? row.memberCode
        : `${row.memberCode} · ${t(`members:status.${row.status}`, { defaultValue: row.status })}`,
  }))

  const restatable = typeof amount === 'string' && AMOUNT.test(amount.trim())

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      width="md"
      busy={record.isPending}
      title={t(kind === 'INCOME' ? 'finance:entryDialog.titleIn' : 'finance:entryDialog.titleOut')}
      description={t(
        kind === 'INCOME'
          ? 'finance:entryDialog.descriptionIn'
          : 'finance:entryDialog.descriptionOut',
      )}
      footer={
        <>
          <Button variant="secondary" disabled={record.isPending} onClick={() => setOpen(false)}>
            {/* The shared "Cancel" is safe here: this dialog abandons a form, it does not cancel
                a record, so there is no opposite meaning sitting next to it. */}
            {t('common:actions.cancel')}
          </Button>
          <Button
            type="submit"
            form="record-entry-form"
            loading={record.isPending}
            disabled={noCategories}
          >
            {t(
              kind === 'INCOME' ? 'finance:entryDialog.submitIn' : 'finance:entryDialog.submitOut',
            )}
          </Button>
        </>
      }
    >
      <form
        id="record-entry-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => void submit(event)}
      >
        {described ? <Alert tone="danger">{described.message}</Alert> : null}
        {noCategories ? (
          <Alert tone="warning">
            {t(
              kind === 'INCOME'
                ? 'finance:entryDialog.noCategoriesIn'
                : 'finance:entryDialog.noCategoriesOut',
            )}
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('finance:entryFields.amount')}
            hint={t('finance:entryFields.amountHint')}
            error={errorFor('amount')}
          >
            {/* `inputMode` rather than `type="number"`: a number input rounds, spins and
                localises the decimal separator, none of which an amount can survive. */}
            <Input inputMode="decimal" autoComplete="off" {...register('amount')} />
          </FormField>

          <FormField
            label={t('finance:entryFields.occurredAt')}
            hint={t('finance:entryFields.occurredAtHint')}
            error={errorFor('occurredAt')}
          >
            <Input type="date" {...register('occurredAt')} />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t(
              kind === 'INCOME'
                ? 'finance:entryFields.categoryIn'
                : 'finance:entryFields.categoryOut',
            )}
            error={errorFor('categoryId')}
          >
            <Select
              options={categoryOptions}
              placeholder={t('finance:entryFields.categoryPlaceholder')}
              value={categoryId ?? ''}
              {...register('categoryId')}
            />
          </FormField>

          <FormField label={t('finance:entryFields.method')} error={errorFor('method')}>
            <Select options={methodOptions} value={method ?? 'CASH'} {...register('method')} />
          </FormField>
        </div>

        <FormField
          label={t('finance:entryFields.description')}
          hint={t('finance:entryFields.descriptionHint')}
          error={errorFor('description')}
        >
          <Textarea rows={2} {...register('description')} />
        </FormField>

        {canSearchMembers ? (
          <FormField
            label={t('finance:entryFields.member')}
            optional
            hint={t('finance:entryFields.memberHint')}
            error={serverFields.memberId}
          >
            <SearchSelect
              value={member}
              onChange={setMember}
              options={memberOptions}
              query={memberQuery}
              onQueryChange={setMemberQuery}
              loading={lookup.isFetching}
              placeholder={t('finance:entryFields.memberPlaceholder')}
              emptyLabel={t('finance:entryFields.memberEmpty')}
              loadingLabel={t('finance:entryFields.memberLoading')}
              clearLabel={t('finance:entryFields.memberClear')}
            />
          </FormField>
        ) : null}

        {/*
          What is about to be recorded, in one sentence, before the button that records it. The
          figure is interpolated into a whole sentence rather than assembled from fragments around
          a component, because Kinyarwanda noun classes make a sentence built from pieces
          grammatically wrong. `formatMoney` is what the `Money` component itself uses, and works
          on the string without parsing it into a number.
        */}
        {restatable ? (
          <p className="rounded-md border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-secondary">
            {t(
              kind === 'INCOME'
                ? 'finance:entryDialog.restateIn'
                : 'finance:entryDialog.restateOut',
              { amount: formatMoney(amount.trim()) },
            )}
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}
