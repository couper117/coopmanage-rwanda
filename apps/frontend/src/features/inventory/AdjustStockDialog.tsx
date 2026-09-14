import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { formatQuantity } from '@coopmanage/shared'
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
import { isQuantity, type AdjustInput, type MovementPreset } from './inventory.api'
import {
  levelOf,
  todayIso,
  useAdjustStock,
  useInventoryError,
  useProductLabel,
  useProductLookup,
  useStockLevel,
  useWarehouses,
} from './inventory.hooks'

/**
 * A count that disagreed with the record.
 *
 * **The field asks what was counted, never the difference.** A storekeeper counts eight sacks and
 * types eight. Working out that the record said ten, and that the correction is therefore two
 * downwards, is the software's job: asking a person to decide whether a correction is positive or
 * negative is how the wrong sign gets recorded, and a store record with the sign reversed is
 * worse than no record. The server takes `countedQuantity` for exactly this reason, and this form
 * sends the characters that were typed.
 *
 * **Zero is a real count.** A shelf found empty is a count of nothing, not a missing value, so
 * the quantity check here accepts "0" where the receive and issue forms refuse it.
 *
 * **The reason is required.** An unexplained correction is what makes a shortfall unauditable,
 * and it is the first thing an auditor asks about.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const schema = z.object({
  // Any quantity the wire can hold, zero included. The sign is never typed: there is no sign.
  countedQuantity: z.string().trim().refine(isQuantity),
  reason: z.string().trim().min(1).max(280),
  occurredAt: z.string().refine((value) => value === '' || DATE_ONLY.test(value)),
  note: z.string().trim().max(280),
})

type FormValues = z.infer<typeof schema>

export interface AdjustStockDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  preset?: MovementPreset | null
  onDone?: (notice: string) => void
}

export function AdjustStockDialog({
  open,
  onOpenChange,
  preset = null,
  onDone,
}: AdjustStockDialogProps) {
  const { t } = useTranslation(['inventory', 'common'])
  const describeError = useInventoryError()
  const productLabel = useProductLabel()
  const adjust = useAdjustStock()

  const warehouses = useWarehouses({ enabled: open })
  const [storeChoice, setStoreChoice] = useState(preset?.warehouseId ?? '')
  const [storeError, setStoreError] = useState<string | null>(null)
  const stores = warehouses.data ?? []
  const defaultStoreId = stores.find((store) => store.isDefault)?.id ?? ''
  const chosenStoreId = storeChoice || defaultStoreId

  const [product, setProduct] = useState<MovementPreset | null>(preset)
  const [productQuery, setProductQuery] = useState('')
  const [productError, setProductError] = useState<string | null>(null)
  const productLookup = useProductLookup(productQuery, open && product === null)

  const levelInput =
    product === null
      ? null
      : { productId: product.productId, sku: product.sku, warehouseId: chosenStoreId }
  const level = useStockLevel(levelInput, open)
  const levelRow = product === null ? null : levelOf(level.data, product.productId)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { countedQuantity: '', reason: '', occurredAt: todayIso(), note: '' },
    mode: 'onBlur',
  })
  const { register, handleSubmit, formState, control } = form

  const counted = useWatch({ control, name: 'countedQuantity' })

  const failed = adjust.error
  const described = failed ? describeError(failed) : null
  const serverFields = described?.fieldErrors ?? {}

  const submit = handleSubmit((values) => {
    if (product === null) {
      setProductError(t('inventory:movementErrors.product'))
      return
    }
    if (chosenStoreId === '') {
      setStoreError(t('inventory:movementErrors.warehouse'))
      return
    }
    const body: AdjustInput = {
      productId: product.productId,
      warehouseId: chosenStoreId,
      // What was counted. The server decides whether the correction goes up or down.
      countedQuantity: values.countedQuantity.trim(),
      reason: values.reason.trim(),
      ...(values.occurredAt ? { occurredAt: values.occurredAt } : {}),
      ...(values.note ? { note: values.note.trim() } : {}),
    }
    adjust.mutate(body, {
      onSuccess: (result) => {
        onDone?.(
          t('inventory:adjustDialog.done', {
            product: product.productName,
            reference: result.reference,
            level: formatQuantity(result.quantityAfter, product.unitSymbol),
          }),
        )
        onOpenChange(false)
      },
    })
  })

  function errorFor(field: keyof FormValues): string | undefined {
    if (formState.errors[field]) return t(`inventory:adjustErrors.${field}`)
    return serverFields[field]
  }

  const storeOptions: SelectOption[] = stores.map((store) => ({
    value: store.id,
    label: store.name,
  }))

  const productOptions: SearchOption[] = (productLookup.data?.items ?? []).map((row) => ({
    value: row.id,
    label: productLabel(row),
    hint: `${row.sku} · ${row.unitSymbol}`,
  }))

  const restatable = typeof counted === 'string' && isQuantity(counted)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="md"
      busy={adjust.isPending}
      title={t('inventory:adjustDialog.title')}
      description={t('inventory:adjustDialog.description')}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={adjust.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" form="adjust-stock-form" loading={adjust.isPending}>
            {t('inventory:adjustDialog.submit')}
          </Button>
        </>
      }
    >
      <form
        id="adjust-stock-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => void submit(event)}
      >
        {described ? <Alert tone="danger">{described.message}</Alert> : null}

        {product === null ? (
          <FormField
            label={t('inventory:movementFields.product')}
            error={productError ?? serverFields.productId}
          >
            <SearchSelect
              value={null}
              onChange={(option) => {
                if (!option) return
                const found = (productLookup.data?.items ?? []).find(
                  (row) => row.id === option.value,
                )
                if (!found) return
                setProduct({
                  productId: found.id,
                  productName: productLabel(found),
                  sku: found.sku,
                  unitSymbol: found.unitSymbol,
                  warehouseId: chosenStoreId,
                })
                setProductError(null)
              }}
              options={productOptions}
              query={productQuery}
              onQueryChange={setProductQuery}
              loading={productLookup.isFetching}
              placeholder={t('inventory:movementFields.productPlaceholder')}
              emptyLabel={t('inventory:movementFields.productEmpty')}
              loadingLabel={t('inventory:movementFields.productLoading')}
              clearLabel={t('inventory:movementFields.productClear')}
            />
          </FormField>
        ) : (
          <div className="rounded-md border border-line bg-surface-subtle px-3 py-2">
            <p className="text-base text-ink">{product.productName}</p>
            <p className="text-sm text-ink-muted">
              {t('inventory:movementFields.productChosen', {
                sku: product.sku,
                unit: product.unitSymbol,
              })}
            </p>
            {preset === null ? (
              <Button variant="link" size="sm" onClick={() => setProduct(null)}>
                {t('inventory:movementFields.changeProduct')}
              </Button>
            ) : null}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('inventory:movementFields.warehouse')}
            error={storeError ?? serverFields.warehouseId}
          >
            <Select
              options={storeOptions}
              placeholder={t('inventory:movementFields.warehousePlaceholder')}
              value={chosenStoreId}
              onChange={(event) => {
                setStoreChoice(event.target.value)
                setStoreError(null)
              }}
            />
          </FormField>

          <FormField
            label={t('inventory:movementFields.occurredAt')}
            hint={t('inventory:movementFields.occurredAtHint')}
            error={errorFor('occurredAt')}
          >
            <Input type="date" {...register('occurredAt')} />
          </FormField>
        </div>

        {/* What the record claims, stated beside the field that disagrees with it. */}
        {levelRow ? (
          <p className="text-sm text-ink-secondary">
            {t('inventory:adjustDialog.recordSays', {
              level: formatQuantity(levelRow.quantity, levelRow.unitSymbol),
              warehouse: levelRow.warehouseName,
            })}
          </p>
        ) : null}

        <FormField
          label={t('inventory:adjustDialog.countedLabel')}
          hint={
            product
              ? t('inventory:adjustDialog.countedHintUnit', { unit: product.unitSymbol })
              : t('inventory:adjustDialog.countedHint')
          }
          error={errorFor('countedQuantity')}
        >
          <Input inputMode="decimal" autoComplete="off" {...register('countedQuantity')} />
        </FormField>

        <FormField
          label={t('inventory:adjustDialog.reasonLabel')}
          hint={t('inventory:adjustDialog.reasonHint')}
          error={errorFor('reason')}
        >
          <Textarea rows={2} {...register('reason')} />
        </FormField>

        <FormField
          label={t('inventory:movementFields.note')}
          optional
          hint={t('inventory:movementFields.noteHint')}
          error={errorFor('note')}
        >
          <Textarea rows={2} {...register('note')} />
        </FormField>

        {/*
          Restated as a count rather than as a difference, so nothing on this screen ever asks the
          reader to check a sign. The sentence is one translation key with the figure interpolated,
          because Kinyarwanda noun classes make a sentence built from fragments wrong.
        */}
        {restatable && product ? (
          <p className="rounded-md border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-secondary">
            {t('inventory:adjustDialog.restate', {
              counted: formatQuantity(counted.trim(), product.unitSymbol),
              product: product.productName,
            })}
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}
