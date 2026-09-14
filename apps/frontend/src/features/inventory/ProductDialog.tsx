import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
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
import {
  isMoney,
  isQuantity,
  PRODUCT_TYPES,
  type ProductInput,
  type ProductRow,
  type ProductType,
  type UpdateProductInput,
} from './inventory.api'
import {
  useCreateProduct,
  useInventoryError,
  useProductCategories,
  useUnits,
  useUnitLabel,
  useUpdateProduct,
} from './inventory.hooks'

/**
 * Adding a product to the catalogue, or changing one already in it.
 *
 * **The unit and the counting decision are frozen once the product has history, and the form says
 * so rather than letting the reader find out from the server.** Changing the unit would restate
 * every quantity already recorded against the product — three hundred kilograms becoming three
 * hundred tonnes — and turning a counted product into an uncounted one would abandon its stock
 * level with no movement to say where it went. The server refuses both with a 409. A form that
 * offered the controls anyway would be inviting the reader to fill in something that cannot be
 * saved, so both are disabled and a sentence explains why.
 *
 * **Two of the rules are the server's and are mirrored here.** A product nobody counts cannot be
 * below a minimum, so the minimum field is absent unless the product is counted; and a service is
 * not held in a store, so choosing `SERVICE` turns counting off and keeps it off.
 *
 * **There is no delete.** A product that has fallen out of use is retired, because movements
 * already recorded against it still have to be able to name it.
 */

const schema = z.object({
  sku: z.string().trim().max(40),
  name: z.string().trim().min(1).max(120),
  nameRw: z.string().trim().max(120),
  categoryId: z.string(),
  unitId: z.string().min(1),
  minStockLevel: z
    .string()
    .trim()
    .refine((value) => value === '' || isQuantity(value)),
  defaultPurchasePrice: z
    .string()
    .trim()
    .refine((value) => value === '' || isMoney(value)),
  defaultSalePrice: z
    .string()
    .trim()
    .refine((value) => value === '' || isMoney(value)),
  description: z.string().trim().max(500),
})

type FormValues = z.infer<typeof schema>

function valuesFor(product: ProductRow | null): FormValues {
  return {
    sku: product?.sku ?? '',
    name: product?.name ?? '',
    nameRw: product?.nameRw ?? '',
    categoryId: product?.categoryId ?? '',
    unitId: product?.unitId ?? '',
    minStockLevel: product?.minStockLevel ?? '',
    defaultPurchasePrice: product?.defaultPurchasePrice ?? '',
    defaultSalePrice: product?.defaultSalePrice ?? '',
    description: product?.description ?? '',
  }
}

export interface ProductDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The product being changed, or null to add one. */
  product?: ProductRow | null
  onDone?: (notice: string) => void
}

export function ProductDialog({ open, onOpenChange, product = null, onDone }: ProductDialogProps) {
  const { t } = useTranslation(['inventory', 'common'])
  const describeError = useInventoryError()
  const unitLabel = useUnitLabel()

  const create = useCreateProduct()
  const update = useUpdateProduct()
  const saving = create.isPending || update.isPending

  const units = useUnits({ enabled: open })
  const categories = useProductCategories({ enabled: open })

  /**
   * The type and the counting decision are held outside the form because they constrain each
   * other: a service is never counted, and an uncounted product has no minimum. Keeping them in
   * state makes those rules a single expression rather than a pair of effects writing values into
   * the form after the reader has already moved on.
   */
  const [type, setType] = useState<ProductType>(product?.type ?? 'GOODS')
  const [tracked, setTracked] = useState(product?.trackInventory ?? true)

  const frozen = product?.hasMovements === true

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: valuesFor(product),
    mode: 'onBlur',
  })
  const { register, handleSubmit, formState, control } = form

  const categoryId = useWatch({ control, name: 'categoryId' })
  const unitId = useWatch({ control, name: 'unitId' })

  const failed = create.error ?? update.error
  const described = failed ? describeError(failed) : null
  const serverFields = described?.fieldErrors ?? {}

  /** A service is not held in a store, so it is never counted whatever the switch last said. */
  const isCounted = type === 'SERVICE' ? false : tracked

  const submit = handleSubmit((values) => {
    const name = values.name.trim()
    if (product === null) {
      const body: ProductInput = {
        name,
        unitId: values.unitId,
        type,
        trackInventory: isCounted,
        ...(values.sku ? { sku: values.sku.trim() } : {}),
        ...(values.nameRw ? { nameRw: values.nameRw.trim() } : {}),
        ...(values.categoryId ? { categoryId: values.categoryId } : {}),
        // Only sent for a counted product: the server refuses a minimum on one nobody counts.
        ...(isCounted && values.minStockLevel
          ? { minStockLevel: values.minStockLevel.trim() }
          : {}),
        ...(values.defaultPurchasePrice
          ? { defaultPurchasePrice: values.defaultPurchasePrice.trim() }
          : {}),
        ...(values.defaultSalePrice ? { defaultSalePrice: values.defaultSalePrice.trim() } : {}),
        ...(values.description ? { description: values.description.trim() } : {}),
      }
      create.mutate(body, {
        onSuccess: (saved) => {
          onDone?.(t('inventory:products.added', { name: saved.name, sku: saved.sku }))
          onOpenChange(false)
        },
      })
      return
    }

    const changes: UpdateProductInput = {
      sku: values.sku.trim() || product.sku,
      name,
      nameRw: values.nameRw.trim() || null,
      categoryId: values.categoryId || null,
      defaultPurchasePrice: values.defaultPurchasePrice.trim() || null,
      defaultSalePrice: values.defaultSalePrice.trim() || null,
      description: values.description.trim() || null,
      minStockLevel: isCounted ? values.minStockLevel.trim() || null : null,
      // Absent once there is history, so a refused change is never even attempted.
      ...(frozen ? {} : { unitId: values.unitId, trackInventory: isCounted }),
    }
    update.mutate(
      { id: product.id, changes },
      {
        onSuccess: (saved) => {
          onDone?.(t('inventory:products.saved', { name: saved.name }))
          onOpenChange(false)
        },
      },
    )
  })

  function errorFor(field: keyof FormValues): string | undefined {
    if (formState.errors[field]) return t(`inventory:productErrors.${field}`)
    return serverFields[field]
  }

  /** Only the units still in service: a product should not be measured in a retired unit. */
  const unitOptions: SelectOption[] = (units.data ?? [])
    .filter((unit) => unit.isActive || unit.id === product?.unitId)
    .map((unit) => ({
      value: unit.id,
      label: `${unitLabel(unit)} (${unit.symbol})`,
    }))

  const categoryOptions: SelectOption[] = [
    { value: '', label: t('inventory:productFields.categoryNone') },
    ...(categories.data ?? [])
      .filter((row) => row.isActive || row.id === product?.categoryId)
      .map((row) => ({ value: row.id, label: row.name })),
  ]

  const typeOptions: SelectOption[] = PRODUCT_TYPES.map((value) => ({
    value,
    label: t(`inventory:productType.${value}`),
  }))

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      busy={saving}
      title={t(
        product === null ? 'inventory:productDialog.addTitle' : 'inventory:productDialog.editTitle',
      )}
      description={t(
        product === null
          ? 'inventory:productDialog.addDescription'
          : 'inventory:productDialog.editDescription',
      )}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={() => onOpenChange(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" form="product-form" loading={saving}>
            {t(
              product === null
                ? 'inventory:productDialog.submitAdd'
                : 'inventory:productDialog.submitEdit',
            )}
          </Button>
        </>
      }
    >
      <form
        id="product-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => void submit(event)}
      >
        {described ? <Alert tone="danger">{described.message}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('inventory:productFields.name')}
            hint={t('inventory:productFields.nameHint')}
            error={errorFor('name')}
          >
            <Input autoComplete="off" {...register('name')} />
          </FormField>

          <FormField
            label={t('inventory:productFields.nameRw')}
            optional
            hint={t('inventory:productFields.nameRwHint')}
            error={errorFor('nameRw')}
          >
            <Input autoComplete="off" {...register('nameRw')} />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('inventory:productFields.sku')}
            optional={product === null}
            hint={t('inventory:productFields.skuHint')}
            error={errorFor('sku')}
          >
            <Input autoComplete="off" {...register('sku')} />
          </FormField>

          <FormField label={t('inventory:productFields.category')} optional>
            <Select
              options={categoryOptions}
              value={categoryId ?? ''}
              {...register('categoryId')}
            />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('inventory:productFields.unit')}
            // The reason the control is disabled sits in the hint, where the reader is already
            // looking, rather than in an alert somewhere above the field.
            hint={
              frozen
                ? t('inventory:productDialog.unitFrozen')
                : t('inventory:productFields.unitHint')
            }
            error={errorFor('unitId')}
          >
            <Select
              options={unitOptions}
              placeholder={t('inventory:productFields.unitPlaceholder')}
              value={unitId ?? ''}
              disabled={frozen}
              {...register('unitId')}
            />
          </FormField>

          <FormField
            label={t('inventory:productFields.type')}
            hint={
              product === null
                ? t('inventory:productFields.typeHint')
                : t('inventory:productDialog.typeFixed')
            }
          >
            <Select
              options={typeOptions}
              value={type}
              disabled={product !== null}
              onChange={(event) => {
                const chosen = PRODUCT_TYPES.find((value) => value === event.target.value)
                if (chosen) setType(chosen)
              }}
            />
          </FormField>
        </div>

        <Switch
          checked={isCounted}
          onCheckedChange={setTracked}
          disabled={frozen || type === 'SERVICE'}
          label={t('inventory:productFields.tracked')}
          description={
            frozen
              ? t('inventory:productDialog.countingFrozen')
              : type === 'SERVICE'
                ? t('inventory:productDialog.serviceNotCounted')
                : t('inventory:productFields.trackedHint')
          }
        />

        {/* A product nobody counts cannot be below a minimum, so the field is not offered. */}
        {isCounted ? (
          <FormField
            label={t('inventory:productFields.minStockLevel')}
            optional
            hint={t('inventory:productFields.minStockLevelHint')}
            error={errorFor('minStockLevel')}
          >
            <Input inputMode="decimal" autoComplete="off" {...register('minStockLevel')} />
          </FormField>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('inventory:productFields.purchasePrice')}
            optional
            hint={t('inventory:productFields.purchasePriceHint')}
            error={errorFor('defaultPurchasePrice')}
          >
            <Input inputMode="decimal" autoComplete="off" {...register('defaultPurchasePrice')} />
          </FormField>

          <FormField
            label={t('inventory:productFields.salePrice')}
            optional
            hint={t('inventory:productFields.salePriceHint')}
            error={errorFor('defaultSalePrice')}
          >
            <Input inputMode="decimal" autoComplete="off" {...register('defaultSalePrice')} />
          </FormField>
        </div>

        <FormField
          label={t('inventory:productFields.description')}
          optional
          error={errorFor('description')}
        >
          <Textarea rows={2} {...register('description')} />
        </FormField>
      </form>
    </Dialog>
  )
}
