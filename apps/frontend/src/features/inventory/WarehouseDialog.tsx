import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Alert, Button, Dialog, FormField, Input, Switch } from '@/components/ui'
import type { UpdateWarehouseInput, WarehouseInput, WarehouseRow } from './inventory.api'
import { useCreateWarehouse, useInventoryError, useUpdateWarehouse } from './inventory.hooks'

/**
 * Adding a store, or changing one the cooperative already keeps.
 *
 * **A cooperative always keeps exactly one default store.** The flag is therefore a control that
 * can only ever be turned on: making this store the default moves it off whichever store held it,
 * and there is no way to leave the cooperative with none. Trying to demote the current default is
 * refused by the server with a 409, so on the store that already holds the flag the switch is
 * disabled and a sentence says to promote another store instead.
 *
 * **Closing a store is not done here.** It is a decision with a consequence — a store holding
 * stock cannot be closed at all, and the stock has to be moved first — so it is confirmed on the
 * stores screen where the quantity held is on the row in front of the reader.
 */

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().max(20),
  district: z.string().trim().max(60),
  sector: z.string().trim().max(60),
})

type FormValues = z.infer<typeof schema>

export interface WarehouseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The store being changed, or null to add one. */
  warehouse?: WarehouseRow | null
  /** True when the cooperative has no store yet, which makes the first one its default. */
  isFirst?: boolean
  onDone?: (notice: string) => void
}

export function WarehouseDialog({
  open,
  onOpenChange,
  warehouse = null,
  isFirst = false,
  onDone,
}: WarehouseDialogProps) {
  const { t } = useTranslation(['inventory', 'common'])
  const describeError = useInventoryError()

  const create = useCreateWarehouse()
  const update = useUpdateWarehouse()
  const saving = create.isPending || update.isPending

  const alreadyDefault = warehouse?.isDefault === true
  const [makeDefault, setMakeDefault] = useState(alreadyDefault || isFirst)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: warehouse?.name ?? '',
      code: warehouse?.code ?? '',
      district: warehouse?.district ?? '',
      sector: warehouse?.sector ?? '',
    },
    mode: 'onBlur',
  })
  const { register, handleSubmit, formState } = form

  const failed = create.error ?? update.error
  const described = failed ? describeError(failed) : null
  const serverFields = described?.fieldErrors ?? {}

  const submit = handleSubmit((values) => {
    if (warehouse === null) {
      const body: WarehouseInput = {
        name: values.name.trim(),
        isDefault: makeDefault,
        ...(values.code ? { code: values.code.trim() } : {}),
        ...(values.district ? { district: values.district.trim() } : {}),
        ...(values.sector ? { sector: values.sector.trim() } : {}),
      }
      create.mutate(body, {
        onSuccess: (saved) => {
          onDone?.(t('inventory:warehouses.added', { name: saved.name, code: saved.code }))
          onOpenChange(false)
        },
      })
      return
    }

    const changes: UpdateWarehouseInput = {
      name: values.name.trim(),
      code: values.code.trim() || warehouse.code,
      district: values.district.trim() || null,
      sector: values.sector.trim() || null,
      // Only sent when it would promote this store. Demoting is refused, and there is no reason
      // to send a flag that says what is already true.
      ...(makeDefault && !alreadyDefault ? { isDefault: true } : {}),
    }
    update.mutate(
      { id: warehouse.id, changes },
      {
        onSuccess: (saved) => {
          onDone?.(t('inventory:warehouses.saved', { name: saved.name }))
          onOpenChange(false)
        },
      },
    )
  })

  function errorFor(field: keyof FormValues): string | undefined {
    if (formState.errors[field]) return t(`inventory:warehouseErrors.${field}`)
    return serverFields[field]
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="md"
      busy={saving}
      title={t(
        warehouse === null
          ? 'inventory:warehouseDialog.addTitle'
          : 'inventory:warehouseDialog.editTitle',
      )}
      description={t(
        warehouse === null
          ? 'inventory:warehouseDialog.addDescription'
          : 'inventory:warehouseDialog.editDescription',
      )}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={() => onOpenChange(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" form="warehouse-form" loading={saving}>
            {t(
              warehouse === null
                ? 'inventory:warehouseDialog.submitAdd'
                : 'inventory:warehouseDialog.submitEdit',
            )}
          </Button>
        </>
      }
    >
      <form
        id="warehouse-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => void submit(event)}
      >
        {described ? <Alert tone="danger">{described.message}</Alert> : null}

        {/* Said before the switch is reached, so the flag on the first store is not a surprise. */}
        {warehouse === null && isFirst ? (
          <Alert tone="info">{t('inventory:warehouseDialog.firstIsDefault')}</Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('inventory:warehouseFields.name')}
            hint={t('inventory:warehouseFields.nameHint')}
            error={errorFor('name')}
          >
            <Input autoComplete="off" {...register('name')} />
          </FormField>

          <FormField
            label={t('inventory:warehouseFields.code')}
            optional={warehouse === null}
            hint={t('inventory:warehouseFields.codeHint')}
            error={errorFor('code')}
          >
            <Input autoComplete="off" {...register('code')} />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('inventory:warehouseFields.district')}
            optional
            error={errorFor('district')}
          >
            <Input autoComplete="off" {...register('district')} />
          </FormField>

          <FormField
            label={t('inventory:warehouseFields.sector')}
            optional
            error={errorFor('sector')}
          >
            <Input autoComplete="off" {...register('sector')} />
          </FormField>
        </div>

        <Switch
          checked={makeDefault}
          onCheckedChange={setMakeDefault}
          disabled={alreadyDefault || isFirst}
          label={t('inventory:warehouseFields.isDefault')}
          description={
            alreadyDefault
              ? t('inventory:warehouseDialog.alreadyDefault')
              : isFirst
                ? t('inventory:warehouseDialog.firstIsDefaultShort')
                : t('inventory:warehouseFields.isDefaultHint')
          }
        />
      </form>
    </Dialog>
  )
}
