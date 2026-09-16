import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
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
import { currentLanguage } from '@/i18n'
import {
  PAYMENT_METHODS,
  SHARE_TYPES,
  type PaymentMethod,
  type ShareInput,
  type ShareType,
} from './members.api'
import {
  todayIso,
  useMemberError,
  useMemberFormOptions,
  useMemberLookup,
  useRecordShare,
} from './members.hooks'

/**
 * Recording a share movement.
 *
 * Shares are the member's stake in the cooperative, so this is arithmetic a member is held to: a
 * whole number of shares at a unit value, and the total is the two multiplied. The unit value is a
 * **string** from the first keystroke to the wire, like every other amount in this product — a
 * float cannot hold a decimal amount exactly, and a share register a franc out is one a member can
 * argue with.
 *
 * Two of the four kinds need something extra, and the form asks for it only then rather than
 * showing four fields that are usually irrelevant:
 *
 * - a **purchase** names the income category the money lands in, because buying shares puts money
 *   into the cooperative and that money has to appear in the books;
 * - a **transfer** names the member on the other side, because a transfer with one party is not a
 *   transfer.
 *
 * The server refuses either omission; asking here means the reader is told before they submit.
 *
 * The profile mounts this only while it is open, so every opening is a fresh mount and the fields
 * start empty without a reset effect — and a failed attempt keeps what was typed, so the reader
 * corrects one field rather than filling the form in again.
 */

/** Whole francs, or francs with up to two decimal places. Nothing else is money. */
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const schema = z
  .object({
    type: z.string().refine((value) => SHARE_TYPES.some((item) => item === value)),
    quantity: z
      .string()
      .trim()
      .refine((value) => /^\d{1,7}$/.test(value) && Number(value) >= 1),
    unitValue: z
      .string()
      .trim()
      .refine((value) => AMOUNT.test(value) && /[1-9]/.test(value)),
    issuedOn: z.string().refine((value) => value === '' || DATE_ONLY.test(value)),
    certificateNo: z.string().trim().max(60),
    counterpartyMemberId: z.string(),
    categoryId: z.string(),
    method: z.string(),
    note: z.string().trim().max(280),
  })
  // The same two conditions the server enforces, checked here so the reader is told before they
  // submit rather than after.
  .refine((value) => value.type !== 'PURCHASE' || value.categoryId.length > 0, {
    path: ['categoryId'],
    message: 'required',
  })
  .refine(
    (value) =>
      (value.type !== 'TRANSFER_IN' && value.type !== 'TRANSFER_OUT') ||
      value.counterpartyMemberId.length > 0,
    { path: ['counterpartyMemberId'], message: 'required' },
  )

type FormValues = z.infer<typeof schema>

function emptyValues(): FormValues {
  return {
    type: '',
    quantity: '',
    unitValue: '',
    issuedOn: todayIso(),
    certificateNo: '',
    counterpartyMemberId: '',
    categoryId: '',
    // Cash is how a cooperative in a rural district is paid nine times in ten.
    method: 'CASH',
    note: '',
  }
}

export interface RecordShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: { id: string; fullName: string; memberCode: string }
  onRecorded?: (result: { quantity: number; totalValue: string }) => void
}

export function RecordShareDialog({
  open,
  onOpenChange,
  member,
  onRecorded,
}: RecordShareDialogProps) {
  const { t } = useTranslation(['members', 'common'])
  const describeError = useMemberError()
  const options = useMemberFormOptions(open)
  const record = useRecordShare()
  const language = currentLanguage()

  /**
   * The other member in a transfer, chosen with the searchable picker rather than a dropdown.
   *
   * A cooperative can have two thousand members, which is not a list to scroll, and two of them
   * share a name often enough that the code has to be visible beside it. `SearchSelect` was built
   * in Phase 4 for exactly this.
   */
  const [counterparty, setCounterparty] = useState<SearchOption | null>(null)
  const [counterpartyQuery, setCounterpartyQuery] = useState('')

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyValues(),
    mode: 'onBlur',
  })
  const { register, handleSubmit, formState, control } = form

  const type = useWatch({ control, name: 'type' }) as ShareType | ''
  const quantity = useWatch({ control, name: 'quantity' })
  const unitValue = useWatch({ control, name: 'unitValue' })

  const isPurchase = type === 'PURCHASE'
  const isTransfer = type === 'TRANSFER_IN' || type === 'TRANSFER_OUT'

  const categories = options.data?.incomeCategories ?? []
  const noCategories = isPurchase && options.isSuccess && categories.length === 0

  const failed = record.error
  const described = failed ? describeError(failed) : null
  const serverFields = described?.fieldErrors ?? {}

  /**
   * The total, worked out for the reader before they commit to it.
   *
   * In exact minor units, not with a float: the quantity is a whole number and the unit value has
   * at most two decimals, so the multiplication is integer arithmetic and cannot drift. This is the
   * figure a member will see on their certificate.
   */
  const total = (): string | null => {
    if (!/^\d+$/.test(quantity) || !AMOUNT.test(unitValue)) return null
    const [whole = '0', fraction = ''] = unitValue.split('.')
    const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2))
    const product = minor * BigInt(quantity)
    return `${product / 100n}.${String(product % 100n).padStart(2, '0')}`
  }

  const typeOptions: SelectOption[] = SHARE_TYPES.map((value) => ({
    value,
    label: t(`members:shares.type.${value}`),
  }))
  const methodOptions: SelectOption[] = PAYMENT_METHODS.map((value) => ({
    value,
    label: t(`members:method.${value}`),
  }))
  const categoryOptions: SelectOption[] = categories.map((category) => ({
    value: category.id,
    label: language === 'rw' && category.nameRw ? category.nameRw : category.name,
  }))
  const lookup = useMemberLookup(counterpartyQuery, open && isTransfer)
  /** The other side of the transfer, never this member: a share cannot be transferred to itself. */
  const counterpartyOptions: SearchOption[] = (lookup.data?.items ?? [])
    .filter((row) => row.id !== member.id)
    .map((row) => ({ value: row.id, label: row.fullName, hint: row.memberCode }))

  const submit = handleSubmit((values) => {
    const body: ShareInput = {
      type: values.type as ShareType,
      quantity: Number(values.quantity),
      // The string the user typed, unchanged.
      unitValue: values.unitValue.trim(),
      ...(values.issuedOn ? { issuedOn: values.issuedOn } : {}),
      ...(values.certificateNo ? { certificateNo: values.certificateNo } : {}),
      ...(isTransfer && counterparty ? { counterpartyMemberId: counterparty.value } : {}),
      ...(isPurchase
        ? { categoryId: values.categoryId, method: values.method as PaymentMethod }
        : {}),
      ...(values.note ? { note: values.note } : {}),
    }

    record.mutate(
      { memberId: member.id, share: body },
      {
        onSuccess: (result) => {
          onRecorded?.(result)
          onOpenChange(false)
        },
      },
    )
  })

  const computed = total()

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('members:shares.record.title')}
      description={t('members:shares.record.description', {
        member: member.fullName,
        code: member.memberCode,
      })}
      busy={record.isPending}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={record.isPending}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={record.isPending || noCategories}>
            {record.isPending ? t('members:shares.record.saving') : t('members:shares.record.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {described ? <Alert tone="danger">{described.message}</Alert> : null}

        {noCategories ? (
          <Alert tone="warning">{t('members:shares.record.noCategories')}</Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('members:shares.record.type')}
            error={formState.errors.type ? 'validation.required' : serverFields.type}
          >
            <Select
              {...register('type')}
              options={typeOptions}
              placeholder={t('members:shares.record.chooseType')}
            />
          </FormField>

          <FormField
            label={t('members:shares.record.issuedOn')}
            error={formState.errors.issuedOn ? 'validation.date' : serverFields.issuedOn}
          >
            <Input type="date" {...register('issuedOn')} />
          </FormField>

          <FormField
            label={t('members:shares.record.quantity')}
            error={
              formState.errors.quantity ? 'validation.positiveWholeNumber' : serverFields.quantity
            }
          >
            <Input inputMode="numeric" {...register('quantity')} />
          </FormField>

          <FormField
            label={t('members:shares.record.unitValue')}
            error={
              formState.errors.unitValue ? 'validation.positiveAmount' : serverFields.unitValue
            }
          >
            <Input inputMode="decimal" {...register('unitValue')} />
          </FormField>
        </div>

        {/*
          The total, restated before it is recorded, which `docs/ui-system.md` §8 asks of every
          financial confirmation. A member's certificate will say this figure.
        */}
        {computed ? (
          <p className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink">
            {t('members:shares.record.total')}{' '}
            <span className="font-semibold tabular-nums">{formatMoney(computed)}</span>
          </p>
        ) : null}

        {isTransfer ? (
          <FormField
            label={t('members:shares.record.counterparty')}
            hint={t('members:shares.record.counterpartyHint')}
            error={
              formState.errors.counterpartyMemberId
                ? 'validation.required'
                : serverFields.counterpartyMemberId
            }
          >
            <SearchSelect
              value={counterparty}
              onChange={(option) => {
                setCounterparty(option)
                // The form's own field is what the resolver checks, so it is kept in step with
                // the picker rather than validated separately.
                form.setValue('counterpartyMemberId', option?.value ?? '', {
                  shouldValidate: true,
                })
              }}
              options={counterpartyOptions}
              query={counterpartyQuery}
              onQueryChange={setCounterpartyQuery}
              loading={lookup.isFetching}
              placeholder={t('members:shares.record.chooseMember')}
              emptyLabel={t('members:shares.record.noMemberFound')}
              loadingLabel={t('common:state.loading')}
              clearLabel={t('members:shares.record.clearMember')}
            />
          </FormField>
        ) : null}

        {isPurchase ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('members:shares.record.category')}
              hint={t('members:shares.record.categoryHint')}
              error={formState.errors.categoryId ? 'validation.required' : serverFields.categoryId}
            >
              <Select
                {...register('categoryId')}
                options={categoryOptions}
                placeholder={t('members:shares.record.chooseCategory')}
              />
            </FormField>
            <FormField label={t('members:shares.record.method')} error={serverFields.method}>
              <Select {...register('method')} options={methodOptions} />
            </FormField>
          </div>
        ) : null}

        <FormField label={t('members:shares.record.certificateNo')} optional>
          <Input {...register('certificateNo')} />
        </FormField>

        <FormField label={t('members:shares.record.note')} optional>
          <Textarea rows={2} {...register('note')} />
        </FormField>
      </div>
    </Dialog>
  )
}
