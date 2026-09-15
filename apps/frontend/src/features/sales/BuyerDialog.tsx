import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { RWANDA_PROVINCES } from '@coopmanage/shared'
import {
  Alert,
  Button,
  Dialog,
  FormField,
  Input,
  Select,
  Switch,
  Textarea,
  type SelectOption,
} from '@/components/ui'
import type { BuyerInput, BuyerRow, UpdateBuyerInput } from './sales.api'
import { useCreateBuyer, useSalesError, useUpdateBuyer } from './sales.hooks'

/**
 * Adding a buyer, or changing what is recorded about one.
 *
 * **A name is all that is required.** Whoever records a sale at the store counter has the buyer's
 * name and may have nothing else, and refusing the sale until somebody finds a telephone number
 * would mean the sale goes unrecorded — which is the one outcome worse than a record with gaps.
 * Every other field says it is optional and stays empty without complaint.
 *
 * **Taking a buyer out of use is the only removal there is.** Every confirmed sale names its
 * buyer, and a report covering last season has to be able to say who bought the maize, so there is
 * no delete here and no endpoint behind one. The switch that puts a buyer out of use appears only
 * when editing, because a buyer being added is in use by definition.
 *
 * On editing, every optional field is sent even when it has been emptied, as an explicit `null`.
 * That is what lets a telephone number written down wrongly be cleared rather than only replaced.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  organization: z.string().trim().max(120),
  contactPerson: z.string().trim().max(120),
  phone: z.string().trim().max(30),
  email: z
    .string()
    .trim()
    .max(160)
    .refine((value) => value === '' || EMAIL.test(value)),
  tin: z.string().trim().max(30),
  province: z.string(),
  district: z.string().trim().max(60),
  sector: z.string().trim().max(60),
  address: z.string().trim().max(280),
  notes: z.string().trim().max(500),
})

type FormValues = z.infer<typeof schema>

export interface BuyerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The buyer being changed, or null when one is being added. */
  buyer?: BuyerRow | null
  /** A finished sentence about what was saved, for the screen to show above its table. */
  onDone?: (notice: string) => void
}

export function BuyerDialog({ open, onOpenChange, buyer = null, onDone }: BuyerDialogProps) {
  const { t } = useTranslation(['sales', 'common'])
  const describeError = useSalesError()
  const create = useCreateBuyer()
  const update = useUpdateBuyer()

  const editing = buyer !== null
  const pending = create.isPending || update.isPending

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: buyer?.name ?? '',
      organization: buyer?.organization ?? '',
      contactPerson: buyer?.contactPerson ?? '',
      phone: buyer?.phone ?? '',
      email: buyer?.email ?? '',
      tin: buyer?.tin ?? '',
      province: buyer?.province ?? '',
      district: buyer?.district ?? '',
      sector: buyer?.sector ?? '',
      address: buyer?.address ?? '',
      notes: buyer?.notes ?? '',
    },
    mode: 'onBlur',
  })
  const { register, handleSubmit, formState, control, setValue } = form
  // `useWatch` rather than `watch`, which returns a function React cannot memoise safely and
  // therefore re-renders the whole dialog on every keystroke in any field.
  const province = useWatch({ control, name: 'province' })

  /**
   * Whether the buyer stays in use.
   *
   * Held outside the form because it is a state rather than a value somebody types, its default
   * comes from the record rather than from a blank field, and it is absent altogether while a
   * buyer is being added. A buyer being added is in use by definition.
   */
  const [isActive, setIsActive] = useState(buyer?.isActive ?? true)

  const failed = create.error ?? update.error
  const described = failed ? describeError(failed) : null
  const serverFields = described?.fieldErrors ?? {}

  const submit = handleSubmit((values) => {
    const name = values.name.trim()

    if (buyer === null) {
      // Only what was filled in is sent. An empty string would be stored as nothing anyway, and
      // leaving the field out keeps the request a description of what is actually known.
      const body: BuyerInput = {
        name,
        ...(values.organization ? { organization: values.organization } : {}),
        ...(values.contactPerson ? { contactPerson: values.contactPerson } : {}),
        ...(values.phone ? { phone: values.phone } : {}),
        ...(values.email ? { email: values.email } : {}),
        ...(values.tin ? { tin: values.tin } : {}),
        ...(values.province ? { province: values.province } : {}),
        ...(values.district ? { district: values.district } : {}),
        ...(values.sector ? { sector: values.sector } : {}),
        ...(values.address ? { address: values.address } : {}),
        ...(values.notes ? { notes: values.notes } : {}),
      }
      create.mutate(body, {
        onSuccess: (row) => {
          onDone?.(t('sales:buyerDialog.doneCreated', { name: row.name }))
          onOpenChange(false)
        },
      })
      return
    }

    // On an edit every field travels, emptied ones as `null`, so a wrong telephone number can be
    // cleared and not merely replaced.
    const changes: UpdateBuyerInput = {
      name,
      organization: values.organization || null,
      contactPerson: values.contactPerson || null,
      phone: values.phone || null,
      email: values.email || null,
      tin: values.tin || null,
      province: values.province || null,
      district: values.district || null,
      sector: values.sector || null,
      address: values.address || null,
      notes: values.notes || null,
      isActive,
    }
    update.mutate(
      { id: buyer.id, changes },
      {
        onSuccess: (row) => {
          onDone?.(t('sales:buyerDialog.doneUpdated', { name: row.name }))
          onOpenChange(false)
        },
      },
    )
  })

  function errorFor(field: keyof FormValues): string | undefined {
    if (formState.errors[field]) {
      return field === 'name' || field === 'email' || field === 'phone'
        ? t(`sales:buyerErrors.${field}`)
        : t('sales:buyerErrors.text')
    }
    return serverFields[field]
  }

  const provinceOptions: SelectOption[] = RWANDA_PROVINCES.map((value) => ({
    value,
    label: t(`sales:province.${value}`),
  }))

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="md"
      busy={pending}
      title={
        editing
          ? t('sales:buyerDialog.editTitle', { name: buyer.name })
          : t('sales:buyerDialog.createTitle')
      }
      description={
        editing ? t('sales:buyerDialog.editDescription') : t('sales:buyerDialog.createDescription')
      }
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>
            {/* The shared "Cancel" is safe here: this abandons a form, it does not cancel a
                record, so nothing meaning the opposite sits beside it. */}
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" form="buyer-form" loading={pending}>
            {editing ? t('sales:buyerDialog.submitEdit') : t('sales:buyerDialog.submitCreate')}
          </Button>
        </>
      }
    >
      <form
        id="buyer-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => void submit(event)}
      >
        {described ? <Alert tone="danger">{described.message}</Alert> : null}

        <FormField
          label={t('sales:buyerDialog.name')}
          hint={t('sales:buyerDialog.nameHint')}
          error={errorFor('name')}
        >
          <Input autoComplete="off" {...register('name')} />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('sales:buyerDialog.organization')}
            optional
            error={errorFor('organization')}
          >
            <Input autoComplete="off" {...register('organization')} />
          </FormField>

          <FormField
            label={t('sales:buyerDialog.contactPerson')}
            optional
            error={errorFor('contactPerson')}
          >
            <Input autoComplete="off" {...register('contactPerson')} />
          </FormField>

          <FormField label={t('sales:buyerDialog.phone')} optional error={errorFor('phone')}>
            <Input inputMode="tel" autoComplete="off" {...register('phone')} />
          </FormField>

          <FormField label={t('sales:buyerDialog.email')} optional error={errorFor('email')}>
            <Input inputMode="email" autoComplete="off" {...register('email')} />
          </FormField>

          <FormField label={t('sales:buyerDialog.tin')} optional error={errorFor('tin')}>
            <Input inputMode="numeric" autoComplete="off" {...register('tin')} />
          </FormField>

          <FormField label={t('sales:buyerDialog.province')} optional error={errorFor('province')}>
            <Select
              options={provinceOptions}
              placeholder={t('sales:buyerDialog.provincePlaceholder')}
              value={province ?? ''}
              onChange={(event) => setValue('province', event.target.value)}
            />
          </FormField>

          <FormField label={t('sales:buyerDialog.district')} optional error={errorFor('district')}>
            <Input autoComplete="off" {...register('district')} />
          </FormField>

          <FormField label={t('sales:buyerDialog.sector')} optional error={errorFor('sector')}>
            <Input autoComplete="off" {...register('sector')} />
          </FormField>
        </div>

        <FormField label={t('sales:buyerDialog.address')} optional error={errorFor('address')}>
          <Input autoComplete="off" {...register('address')} />
        </FormField>

        <FormField
          label={t('sales:buyerDialog.notes')}
          optional
          hint={t('sales:buyerDialog.notesHint')}
          error={errorFor('notes')}
        >
          <Textarea rows={2} {...register('notes')} />
        </FormField>

        {/*
          Only when editing. A buyer being added is in use by definition, and the switch is the
          whole of the removal this feature has: their history stays exactly as it is.
        */}
        {editing ? (
          <Switch
            checked={isActive}
            onCheckedChange={setIsActive}
            label={t('sales:buyerDialog.isActive')}
            description={t('sales:buyerDialog.isActiveHint')}
          />
        ) : null}
      </form>
    </Dialog>
  )
}
