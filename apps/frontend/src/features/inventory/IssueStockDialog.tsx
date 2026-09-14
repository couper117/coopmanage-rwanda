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
import { isPositiveQuantity, type IssueInput, type MovementPreset } from './inventory.api'
import {
  isInsufficientStock,
  levelOf,
  todayIso,
  useInventoryError,
  useIssueStock,
  useProductLabel,
  useProductLookup,
  useStockLevel,
  useWarehouses,
} from './inventory.hooks'

/**
 * Stock leaving a store for any reason other than a sale.
 *
 * **The refusal for too little stock is handled by re-reading, not by arithmetic.** The server
 * replies 409 and deliberately does not say how much there is, because by the time a storekeeper
 * on a slow connection reads the refusal the level may have moved again. So this dialog reports
 * the refusal and then reads the level afresh, and the sentence it shows names the figure that is
 * recorded now rather than a figure computed from the request that failed. The level is also shown
 * before anything is typed, which is the cheapest way to prevent the refusal in the first place.
 *
 * The quantity is a string of characters from the first keystroke to the wire, for the reason
 * given at length in `ReceiveStockDialog`.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const schema = z.object({
  quantity: z.string().trim().refine(isPositiveQuantity),
  occurredAt: z.string().refine((value) => value === '' || DATE_ONLY.test(value)),
  reason: z.string().trim().max(280),
  note: z.string().trim().max(280),
})

type FormValues = z.infer<typeof schema>

/** The handful of reasons stock leaves a cooperative's store without being sold. */
const ISSUE_REASONS = ['OWN_USE', 'SPOILAGE', 'SAMPLE', 'DONATION', 'OTHER'] as const

export interface IssueStockDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  preset?: MovementPreset | null
  onDone?: (notice: string) => void
}

export function IssueStockDialog({
  open,
  onOpenChange,
  preset = null,
  onDone,
}: IssueStockDialogProps) {
  const { t } = useTranslation(['inventory', 'common'])
  const describeError = useInventoryError()
  const productLabel = useProductLabel()
  const issue = useIssueStock()

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
    defaultValues: { quantity: '', occurredAt: todayIso(), reason: '', note: '' },
    mode: 'onBlur',
  })
  const { register, handleSubmit, formState, control } = form

  const quantity = useWatch({ control, name: 'quantity' })
  const reason = useWatch({ control, name: 'reason' })

  const failed = issue.error
  const described = failed ? describeError(failed) : null
  const serverFields = described?.fieldErrors ?? {}
  const refusedForStock = isInsufficientStock(failed)

  const submit = handleSubmit((values) => {
    if (product === null) {
      setProductError(t('inventory:movementErrors.product'))
      return
    }
    if (chosenStoreId === '') {
      setStoreError(t('inventory:movementErrors.warehouse'))
      return
    }
    const body: IssueInput = {
      productId: product.productId,
      warehouseId: chosenStoreId,
      quantity: values.quantity.trim(),
      ...(values.occurredAt ? { occurredAt: values.occurredAt } : {}),
      ...(values.reason ? { reason: t(`inventory:issueReason.${values.reason}`) } : {}),
      ...(values.note ? { note: values.note.trim() } : {}),
    }
    issue.mutate(body, {
      onSuccess: (result) => {
        onDone?.(
          t('inventory:issueDialog.done', {
            quantity: formatQuantity(result.quantity, product.unitSymbol),
            product: product.productName,
            reference: result.reference,
            level: formatQuantity(result.quantityAfter, product.unitSymbol),
          }),
        )
        onOpenChange(false)
      },
      onError: (error) => {
        // The one refusal that calls for a fresh read rather than a message alone.
        if (isInsufficientStock(error)) void level.refetch()
      },
    })
  })

  function errorFor(field: keyof FormValues): string | undefined {
    if (formState.errors[field]) return t(`inventory:issueErrors.${field}`)
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

  const reasonOptions: SelectOption[] = [
    { value: '', label: t('inventory:issueReason.none') },
    ...ISSUE_REASONS.map((value) => ({ value, label: t(`inventory:issueReason.${value}`) })),
  ]

  const restatable = typeof quantity === 'string' && isPositiveQuantity(quantity)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="md"
      busy={issue.isPending}
      title={t('inventory:issueDialog.title')}
      description={t('inventory:issueDialog.description')}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={issue.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" form="issue-stock-form" loading={issue.isPending}>
            {t('inventory:issueDialog.submit')}
          </Button>
        </>
      }
    >
      <form
        id="issue-stock-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => void submit(event)}
      >
        {/*
          A refusal for too little stock is reported with the level as it stands now, read again
          after the refusal. No figure here comes from the failed request, and none is worked out
          by subtraction: the server never said how much there was.
        */}
        {refusedForStock ? (
          <Alert tone="danger" title={t('inventory:issueDialog.notEnoughTitle')}>
            {levelRow
              ? t('inventory:issueDialog.notEnoughNow', {
                  level: formatQuantity(levelRow.quantity, levelRow.unitSymbol),
                  warehouse: levelRow.warehouseName,
                })
              : t('inventory:issueDialog.notEnoughUnknown')}
          </Alert>
        ) : described ? (
          <Alert tone="danger">{described.message}</Alert>
        ) : null}

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
        </div>

        {/* What the record says is there, so the storekeeper is not guessing before they type. */}
        {levelRow ? (
          <p className="text-sm text-ink-secondary">
            {t('inventory:movementFields.levelNow', {
              level: formatQuantity(levelRow.quantity, levelRow.unitSymbol),
              warehouse: levelRow.warehouseName,
            })}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('inventory:movementFields.reason')} optional>
            <Select options={reasonOptions} value={reason ?? ''} {...register('reason')} />
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

        {restatable && product ? (
          <p className="rounded-md border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-secondary">
            {t('inventory:issueDialog.restate', {
              quantity: formatQuantity(quantity.trim(), product.unitSymbol),
              product: product.productName,
            })}
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}
