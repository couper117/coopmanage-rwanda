import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Alert, Button, Dialog, FormField, Input, Select, type SelectOption } from '@/components/ui'
import type { UnitInput, UnitRow, UpdateUnitInput } from './inventory.api'
import { useCreateUnit, useInventoryError, useUnitLabel, useUpdateUnit } from './inventory.hooks'

/**
 * A unit of measure the cooperative adds for itself, or a rename of one it already added.
 *
 * **Kilograms are not assumed anywhere in this product.** A cooperative measures in what it
 * measures in — sacks, litres, bunches, days of tractor hire — so the platform seeds a handful of
 * units every cooperative shares and lets each one add its own. A seeded unit can be chosen but
 * never renamed, because the rename would reach every cooperative at once; the stores screen
 * therefore offers no edit control on one, and this dialog is only ever opened for a unit the
 * cooperative owns.
 *
 * **The key and the number of decimal places cannot change once the unit exists.** The key is
 * what paper and code refer to, and the precision is the number of decimal places every quantity
 * already recorded in this unit was rounded to: loosening or tightening it afterwards would
 * silently restate history. Both are shown on the edit form as fixed facts rather than hidden, so
 * a reader looking for them knows they were withheld deliberately.
 */

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/

const schema = z.object({
  key: z.string().trim(),
  nameEn: z.string().trim().min(1).max(60),
  nameRw: z.string().trim().min(1).max(60),
  symbol: z.string().trim().min(1).max(12),
  precision: z.string(),
  baseUnitId: z.string(),
  factorToBase: z.string().trim(),
})

type FormValues = z.infer<typeof schema>

/** Zero to three decimal places, which is what the server accepts and the database holds. */
const PRECISIONS = ['0', '1', '2', '3'] as const

export interface UnitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The unit being renamed, or null to add one. Never a unit the platform seeded. */
  unit?: UnitRow | null
  /** The cooperative's units and the seeded ones, for choosing what a new unit is built on. */
  units?: UnitRow[]
  onDone?: (notice: string) => void
}

export function UnitDialog({
  open,
  onOpenChange,
  unit = null,
  units = [],
  onDone,
}: UnitDialogProps) {
  const { t } = useTranslation(['inventory', 'common'])
  const describeError = useInventoryError()
  const unitLabel = useUnitLabel()

  const create = useCreateUnit()
  const update = useUpdateUnit()
  const saving = create.isPending || update.isPending

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      key: unit?.key ?? '',
      nameEn: unit?.nameEn ?? '',
      nameRw: unit?.nameRw ?? '',
      symbol: unit?.symbol ?? '',
      precision: unit ? String(unit.precision) : '2',
      baseUnitId: unit?.baseUnitId ?? '',
      factorToBase: unit?.factorToBase ?? '',
    },
    mode: 'onBlur',
  })
  const { register, handleSubmit, formState, control } = form

  const precision = useWatch({ control, name: 'precision' })
  const baseUnitId = useWatch({ control, name: 'baseUnitId' })

  const failed = create.error ?? update.error
  const described = failed ? describeError(failed) : null
  const serverFields = described?.fieldErrors ?? {}

  const submit = handleSubmit((values) => {
    if (unit === null) {
      const key = values.key.trim().toUpperCase()
      if (!KEY_PATTERN.test(key)) {
        form.setError('key', { type: 'manual' })
        return
      }
      if (values.baseUnitId !== '' && values.factorToBase.trim() === '') {
        // A unit built on another has to say how many of it there are, or the conversion is a
        // guess. The server refuses this too.
        form.setError('factorToBase', { type: 'manual' })
        return
      }
      const body: UnitInput = {
        key,
        nameEn: values.nameEn.trim(),
        nameRw: values.nameRw.trim(),
        symbol: values.symbol.trim(),
        precision: Number(values.precision),
        ...(values.baseUnitId
          ? { baseUnitId: values.baseUnitId, factorToBase: values.factorToBase.trim() }
          : {}),
      }
      create.mutate(body, {
        onSuccess: (saved) => {
          onDone?.(t('inventory:units.added', { name: unitLabel(saved), symbol: saved.symbol }))
          onOpenChange(false)
        },
      })
      return
    }

    const changes: UpdateUnitInput = {
      nameEn: values.nameEn.trim(),
      nameRw: values.nameRw.trim(),
      symbol: values.symbol.trim(),
    }
    update.mutate(
      { id: unit.id, changes },
      {
        onSuccess: (saved) => {
          onDone?.(t('inventory:units.saved', { name: unitLabel(saved) }))
          onOpenChange(false)
        },
      },
    )
  })

  function errorFor(field: keyof FormValues): string | undefined {
    if (formState.errors[field]) return t(`inventory:unitErrors.${field}`)
    return serverFields[field]
  }

  const precisionOptions: SelectOption[] = PRECISIONS.map((value) => ({
    value,
    label: t(`inventory:unitFields.precisionOption.${value}`),
  }))

  /** Only a unit that is not itself built on another, so a chain of conversions cannot form. */
  const baseOptions: SelectOption[] = [
    { value: '', label: t('inventory:unitFields.baseNone') },
    ...units
      .filter((row) => row.isActive && row.baseUnitId === null && row.id !== unit?.id)
      .map((row) => ({ value: row.id, label: `${unitLabel(row)} (${row.symbol})` })),
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="md"
      busy={saving}
      title={t(unit === null ? 'inventory:unitDialog.addTitle' : 'inventory:unitDialog.editTitle')}
      description={t(
        unit === null
          ? 'inventory:unitDialog.addDescription'
          : 'inventory:unitDialog.editDescription',
      )}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={() => onOpenChange(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" form="unit-form" loading={saving}>
            {t(
              unit === null ? 'inventory:unitDialog.submitAdd' : 'inventory:unitDialog.submitEdit',
            )}
          </Button>
        </>
      }
    >
      <form
        id="unit-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => void submit(event)}
      >
        {described ? <Alert tone="danger">{described.message}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('inventory:unitFields.key')}
            hint={
              unit === null ? t('inventory:unitFields.keyHint') : t('inventory:unitDialog.keyFixed')
            }
            error={errorFor('key')}
          >
            <Input
              autoComplete="off"
              disabled={unit !== null}
              // Not a translatable string: the key is an uppercase ASCII identifier the cooperative
              // types itself, and this is an example of the shape rather than a word to read.
              placeholder="SACK_50KG"
              {...register('key')}
            />
          </FormField>

          <FormField
            label={t('inventory:unitFields.symbol')}
            hint={t('inventory:unitFields.symbolHint')}
            error={errorFor('symbol')}
          >
            <Input autoComplete="off" {...register('symbol')} />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('inventory:unitFields.nameEn')} error={errorFor('nameEn')}>
            <Input autoComplete="off" {...register('nameEn')} />
          </FormField>

          <FormField label={t('inventory:unitFields.nameRw')} error={errorFor('nameRw')}>
            <Input autoComplete="off" {...register('nameRw')} />
          </FormField>
        </div>

        <FormField
          label={t('inventory:unitFields.precision')}
          hint={
            unit === null
              ? t('inventory:unitFields.precisionHint')
              : t('inventory:unitDialog.precisionFixed')
          }
        >
          <Select
            options={precisionOptions}
            value={precision ?? '2'}
            disabled={unit !== null}
            {...register('precision')}
          />
        </FormField>

        {unit === null ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('inventory:unitFields.base')} optional>
              <Select options={baseOptions} value={baseUnitId ?? ''} {...register('baseUnitId')} />
            </FormField>

            <FormField
              label={t('inventory:unitFields.factor')}
              optional
              hint={t('inventory:unitFields.factorHint')}
              error={errorFor('factorToBase')}
            >
              <Input
                inputMode="decimal"
                autoComplete="off"
                disabled={baseUnitId === ''}
                {...register('factorToBase')}
              />
            </FormField>
          </div>
        ) : null}
      </form>
    </Dialog>
  )
}
