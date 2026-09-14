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
import { isPositiveQuantity, type MovementPreset, type TransferInput } from './inventory.api'
import {
  levelOf,
  todayIso,
  useInventoryError,
  useProductLabel,
  useProductLookup,
  useStockLevel,
  useTransferStock,
  useWarehouses,
} from './inventory.hooks'

/**
 * Stock moving between two of the cooperative's own stores.
 *
 * **The form refuses a transfer to the same store itself.** The server refuses it too, with a 422,
 * but a request that can only fail should not be sent: the reader is told which field is wrong
 * rather than handed a validation failure about the whole form, and the mistake is caught while
 * their attention is still on the two select boxes.
 *
 * One transfer is two movements, written in one transaction, each naming the other. The sentence
 * this dialog reports back names both, because "it moved" is not something a storekeeper can
 * check against anything, and two references are.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const schema = z.object({
  quantity: z.string().trim().refine(isPositiveQuantity),
  occurredAt: z.string().refine((value) => value === '' || DATE_ONLY.test(value)),
  note: z.string().trim().max(280),
})

type FormValues = z.infer<typeof schema>

export interface TransferStockDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  preset?: MovementPreset | null
  onDone?: (notice: string) => void
}

export function TransferStockDialog({
  open,
  onOpenChange,
  preset = null,
  onDone,
}: TransferStockDialogProps) {
  const { t } = useTranslation(['inventory', 'common'])
  const describeError = useInventoryError()
  const productLabel = useProductLabel()
  const transfer = useTransferStock()

  const warehouses = useWarehouses({ enabled: open })
  const stores = warehouses.data ?? []
  const defaultStoreId = stores.find((store) => store.isDefault)?.id ?? ''

  const [fromChoice, setFromChoice] = useState(preset?.warehouseId ?? '')
  const [toChoice, setToChoice] = useState('')
  const [fromError, setFromError] = useState<string | null>(null)
  const [toError, setToError] = useState<string | null>(null)
  const fromId = fromChoice || defaultStoreId

  const [product, setProduct] = useState<MovementPreset | null>(preset)
  const [productQuery, setProductQuery] = useState('')
  const [productError, setProductError] = useState<string | null>(null)
  const productLookup = useProductLookup(productQuery, open && product === null)

  const levelInput =
    product === null
      ? null
      : { productId: product.productId, sku: product.sku, warehouseId: fromId }
  const level = useStockLevel(levelInput, open)
  const levelRow = product === null ? null : levelOf(level.data, product.productId)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { quantity: '', occurredAt: todayIso(), note: '' },
    mode: 'onBlur',
  })
  const { register, handleSubmit, formState, control } = form

  const quantity = useWatch({ control, name: 'quantity' })

  const failed = transfer.error
  const described = failed ? describeError(failed) : null
  const serverFields = described?.fieldErrors ?? {}

  const submit = handleSubmit((values) => {
    if (product === null) {
      setProductError(t('inventory:movementErrors.product'))
      return
    }
    if (fromId === '') {
      setFromError(t('inventory:movementErrors.warehouse'))
      return
    }
    if (toChoice === '') {
      setToError(t('inventory:movementErrors.warehouse'))
      return
    }
    if (toChoice === fromId) {
      // Refused here rather than by the server: a transfer within one store moves nothing.
      setToError(t('inventory:transferDialog.sameStore'))
      return
    }
    const body: TransferInput = {
      productId: product.productId,
      fromWarehouseId: fromId,
      toWarehouseId: toChoice,
      quantity: values.quantity.trim(),
      ...(values.occurredAt ? { occurredAt: values.occurredAt } : {}),
      ...(values.note ? { note: values.note.trim() } : {}),
    }
    transfer.mutate(body, {
      onSuccess: (result) => {
        onDone?.(
          t('inventory:transferDialog.done', {
            quantity: formatQuantity(result.out.quantity, product.unitSymbol),
            product: product.productName,
            outReference: result.out.reference,
            inReference: result.in.reference,
          }),
        )
        onOpenChange(false)
      },
    })
  })

  function errorFor(field: keyof FormValues): string | undefined {
    if (formState.errors[field]) return t(`inventory:transferErrors.${field}`)
    return serverFields[field]
  }

  const fromOptions: SelectOption[] = stores.map((store) => ({
    value: store.id,
    label: store.name,
  }))

  /**
   * The store the stock is going to, with the one it is leaving marked unavailable rather than
   * removed. Removing it would renumber the list the moment the source changed, and a reader who
   * had already picked a destination would find their choice silently moved.
   */
  const toOptions: SelectOption[] = stores.map((store) => ({
    value: store.id,
    label:
      store.id === fromId
        ? t('inventory:transferDialog.sameAsSource', { name: store.name })
        : store.name,
    disabled: store.id === fromId,
  }))

  const productOptions: SearchOption[] = (productLookup.data?.items ?? []).map((row) => ({
    value: row.id,
    label: productLabel(row),
    hint: `${row.sku} · ${row.unitSymbol}`,
  }))

  const restatable = typeof quantity === 'string' && isPositiveQuantity(quantity)
  const toName = stores.find((store) => store.id === toChoice)?.name ?? ''

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="md"
      busy={transfer.isPending}
      title={t('inventory:transferDialog.title')}
      description={t('inventory:transferDialog.description')}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={transfer.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" form="transfer-stock-form" loading={transfer.isPending}>
            {t('inventory:transferDialog.submit')}
          </Button>
        </>
      }
    >
      <form
        id="transfer-stock-form"
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
                  warehouseId: fromId,
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
            label={t('inventory:transferDialog.from')}
            error={fromError ?? serverFields.fromWarehouseId}
          >
            <Select
              options={fromOptions}
              placeholder={t('inventory:movementFields.warehousePlaceholder')}
              value={fromId}
              onChange={(event) => {
                setFromChoice(event.target.value)
                setFromError(null)
                setToError(null)
              }}
            />
          </FormField>

          <FormField
            label={t('inventory:transferDialog.to')}
            error={toError ?? serverFields.toWarehouseId}
          >
            <Select
              options={toOptions}
              placeholder={t('inventory:transferDialog.toPlaceholder')}
              value={toChoice}
              onChange={(event) => {
                setToChoice(event.target.value)
                setToError(null)
              }}
            />
          </FormField>
        </div>

        {levelRow ? (
          <p className="text-sm text-ink-secondary">
            {t('inventory:movementFields.levelNow', {
              level: formatQuantity(levelRow.quantity, levelRow.unitSymbol),
              warehouse: levelRow.warehouseName,
            })}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('inventory:movementFields.quantity')}
            hint={
              product
                ? t('inventory:movementFields.quantityHintUnit', { unit: product.unitSymbol })
                : t('inventory:movementFields.quantityHint')
            }
            error={errorFor('quantity')}
          >
            <Input inputMode="decimal" autoComplete="off" {...register('quantity')} />
          </FormField>

          <FormField
            label={t('inventory:movementFields.occurredAt')}
            hint={t('inventory:movementFields.occurredAtHint')}
            error={errorFor('occurredAt')}
          >
            <Input type="date" {...register('occurredAt')} />
          </FormField>
        </div>

        <FormField
          label={t('inventory:movementFields.note')}
          optional
          hint={t('inventory:movementFields.noteHint')}
          error={errorFor('note')}
        >
          <Textarea rows={2} {...register('note')} />
        </FormField>

        {restatable && product && toName ? (
          <p className="rounded-md border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-secondary">
            {t('inventory:transferDialog.restate', {
              quantity: formatQuantity(quantity.trim(), product.unitSymbol),
              product: product.productName,
              warehouse: toName,
            })}
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}
