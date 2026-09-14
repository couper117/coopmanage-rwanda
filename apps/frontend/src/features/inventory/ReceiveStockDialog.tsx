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
import { usePermission } from '@/features/auth/useSession'
import { useFinanceCategories } from '@/features/finance/finance.hooks'
import { useMemberLookup } from '@/features/members/members.hooks'
import {
  isMoney,
  isPositiveQuantity,
  PAYMENT_METHODS,
  type MovementPreset,
  type PaymentMethod,
  type ReceiveInput,
} from './inventory.api'
import {
  todayIso,
  useInventoryError,
  useProductLabel,
  useProductLookup,
  useReceiveStock,
  useWarehouses,
} from './inventory.hooks'

/**
 * Stock arriving at one of the cooperative's stores.
 *
 * **The quantity is a string from the first keystroke to the wire.** It is never put through
 * `Number` or `parseFloat`: the server holds quantities to the gram, and a delivery that arrives
 * a gram short every time is a store record nobody can reconcile against a weighbridge ticket.
 * The field collects characters, the check is a regular expression over those characters, and the
 * same characters are what the server receives.
 *
 * **The member who delivered it is part of the receipt, not a separate record.** There is no
 * deliveries table, so naming the member here is what puts the delivery on their history, and the
 * two can never disagree. The field is offered only to somebody who may read the register, since
 * finding a member means searching it.
 *
 * **The cost is optional, and posting it to the books is a second, separate decision.** A member
 * often delivers produce before a price is agreed, so a receipt with no cost is the normal case.
 * Where the cooperative did pay, naming an expense category posts the expense inside the same
 * transaction — which is why the server requires a unit cost alongside it, and why this form asks
 * for one rather than sending a receipt it already knows will be refused. That section is hidden
 * altogether without `finance:view`, because choosing a category means reading the list of them.
 *
 * Every control here is behind a permission the server checks again on every request, whatever
 * the interface chose to show.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const schema = z
  .object({
    quantity: z.string().trim().refine(isPositiveQuantity),
    unitCost: z
      .string()
      .trim()
      .refine((value) => value === '' || isMoney(value)),
    occurredAt: z.string().refine((value) => value === '' || DATE_ONLY.test(value)),
    note: z.string().trim().max(280),
    expenseCategoryId: z.string(),
    method: z.string(),
  })
  // The server refuses a receipt that posts an expense without a cost. Saying so here means the
  // reader is told which field to fill in rather than handed a refusal about the whole form.
  .refine((values) => values.expenseCategoryId === '' || values.unitCost !== '', {
    path: ['unitCost'],
  })

type FormValues = z.infer<typeof schema>

export interface ReceiveStockDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The product and store a row's own action already chose, so the reader keeps their place. */
  preset?: MovementPreset | null
  /** A finished sentence about what was recorded, for the screen to show above the table. */
  onDone?: (notice: string) => void
}

export function ReceiveStockDialog({
  open,
  onOpenChange,
  preset = null,
  onDone,
}: ReceiveStockDialogProps) {
  const { t } = useTranslation(['inventory', 'members', 'common'])
  const describeError = useInventoryError()
  const productLabel = useProductLabel()
  const receive = useReceiveStock()

  const warehouses = useWarehouses({ enabled: open })

  /**
   * Which product is being received.
   *
   * Held here rather than in the form because it is a chosen object rather than typed text, and
   * because the dialog needs the unit symbol to say what the quantity field is asking for. A
   * preset arrives already chosen and the picker is not shown at all.
   */
  const [product, setProduct] = useState<MovementPreset | null>(preset)
  const [productQuery, setProductQuery] = useState('')
  const productLookup = useProductLookup(productQuery, open && product === null)

  /**
   * Who delivered it. Offered only to somebody who may read the register; the server checks the
   * member belongs to this cooperative whatever the interface sent.
   */
  const canSearchMembers = usePermission('members:view')
  const [member, setMember] = useState<SearchOption | null>(null)
  const [memberQuery, setMemberQuery] = useState('')
  const memberLookup = useMemberLookup(memberQuery, open && canSearchMembers)

  /**
   * Whether the cost can be posted to the books at all. Reading the expense categories needs
   * `finance:view`, which an inventory officer does not hold, so for them the whole section is
   * absent rather than present and broken.
   */
  const canPostExpense = usePermission('finance:view')
  const expenseCategories = useFinanceCategories({
    kind: 'EXPENSE',
    enabled: open && canPostExpense,
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      quantity: '',
      unitCost: '',
      occurredAt: todayIso(),
      note: '',
      expenseCategoryId: '',
      // Cash is how a cooperative in a rural district pays, nine times in ten.
      method: 'CASH',
    },
    mode: 'onBlur',
  })
  const { register, handleSubmit, formState, control } = form

  const quantity = useWatch({ control, name: 'quantity' })
  const expenseCategoryId = useWatch({ control, name: 'expenseCategoryId' })
  const method = useWatch({ control, name: 'method' })

  /**
   * Which store the stock is arriving at.
   *
   * Held outside the form so the cooperative's default store can stand in until the reader
   * chooses otherwise, without an effect writing a value into the form after the fact. Stock has
   * to arrive somewhere, and a cooperative always keeps exactly one default.
   */
  const [storeChoice, setStoreChoice] = useState(preset?.warehouseId ?? '')
  const [storeError, setStoreError] = useState<string | null>(null)
  const stores = warehouses.data ?? []
  const defaultStoreId = stores.find((store) => store.isDefault)?.id ?? ''
  const chosenStoreId = storeChoice || defaultStoreId

  const failed = receive.error
  const described = failed ? describeError(failed) : null
  const serverFields = described?.fieldErrors ?? {}

  const [productError, setProductError] = useState<string | null>(null)

  const submit = handleSubmit((values) => {
    if (product === null) {
      setProductError(t('inventory:movementErrors.product'))
      return
    }
    if (chosenStoreId === '') {
      setStoreError(t('inventory:movementErrors.warehouse'))
      return
    }
    const body: ReceiveInput = {
      productId: product.productId,
      warehouseId: chosenStoreId,
      // The characters the user typed, unchanged.
      quantity: values.quantity.trim(),
      ...(values.unitCost ? { unitCost: values.unitCost.trim() } : {}),
      ...(member ? { sourceMemberId: member.value } : {}),
      ...(values.occurredAt ? { occurredAt: values.occurredAt } : {}),
      ...(values.note ? { note: values.note.trim() } : {}),
      ...(canPostExpense && values.expenseCategoryId
        ? {
            expenseCategoryId: values.expenseCategoryId,
            method: readPaymentMethod(values.method),
          }
        : {}),
    }
    receive.mutate(body, {
      onSuccess: (result) => {
        onDone?.(
          t('inventory:receiveDialog.done', {
            quantity: formatQuantity(result.quantity, product.unitSymbol),
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
    if (formState.errors[field]) return t(`inventory:receiveErrors.${field}`)
    return serverFields[field]
  }

  const storeOptions: SelectOption[] = stores.map((store) => ({
    value: store.id,
    label: store.name,
  }))

  /** The code goes in the hint, because two products in a catalogue often read alike. */
  const productOptions: SearchOption[] = (productLookup.data?.items ?? []).map((row) => ({
    value: row.id,
    label: productLabel(row),
    hint: `${row.sku} · ${row.unitSymbol}`,
  }))

  const memberOptions: SearchOption[] = (memberLookup.data?.items ?? []).map((row) => ({
    value: row.id,
    label: row.fullName,
    hint:
      row.status === 'ACTIVE'
        ? row.memberCode
        : `${row.memberCode} · ${t(`members:status.${row.status}`, { defaultValue: row.status })}`,
  }))

  const expenseOptions: SelectOption[] = (expenseCategories.data ?? [])
    .filter((row) => row.isActive)
    .map((row) => ({ value: row.id, label: row.name }))

  const methodOptions: SelectOption[] = PAYMENT_METHODS.map((value) => ({
    value,
    label: t(`inventory:method.${value}`),
  }))

  const restatable = typeof quantity === 'string' && isPositiveQuantity(quantity)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="md"
      busy={receive.isPending}
      title={t('inventory:receiveDialog.title')}
      description={t('inventory:receiveDialog.description')}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={receive.isPending}
            onClick={() => onOpenChange(false)}
          >
            {/* The shared "Cancel" is safe here: this abandons a form, it does not cancel a
                movement, so nothing meaning the opposite sits beside it. */}
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" form="receive-stock-form" loading={receive.isPending}>
            {t('inventory:receiveDialog.submit')}
          </Button>
        </>
      }
    >
      <form
        id="receive-stock-form"
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
            label={t('inventory:movementFields.quantity')}
            hint={
              product
                ? t('inventory:movementFields.quantityHintUnit', { unit: product.unitSymbol })
                : t('inventory:movementFields.quantityHint')
            }
            error={errorFor('quantity')}
          >
            {/* `inputMode` rather than `type="number"`: a number input rounds, spins and
                localises the decimal separator, none of which a weight can survive. */}
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

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('inventory:movementFields.unitCost')}
            optional
            hint={t('inventory:movementFields.unitCostHint')}
            error={errorFor('unitCost')}
          >
            <Input inputMode="decimal" autoComplete="off" {...register('unitCost')} />
          </FormField>

          <FormField
            label={t('inventory:movementFields.occurredAt')}
            hint={t('inventory:movementFields.occurredAtHint')}
            error={errorFor('occurredAt')}
          >
            <Input type="date" {...register('occurredAt')} />
          </FormField>
        </div>

        {canSearchMembers ? (
          <FormField
            label={t('inventory:movementFields.member')}
            optional
            hint={t('inventory:movementFields.memberHint')}
            error={serverFields.sourceMemberId}
          >
            <SearchSelect
              value={member}
              onChange={setMember}
              options={memberOptions}
              query={memberQuery}
              onQueryChange={setMemberQuery}
              loading={memberLookup.isFetching}
              placeholder={t('inventory:movementFields.memberPlaceholder')}
              emptyLabel={t('inventory:movementFields.memberEmpty')}
              loadingLabel={t('inventory:movementFields.memberLoading')}
              clearLabel={t('inventory:movementFields.memberClear')}
            />
          </FormField>
        ) : null}

        <FormField
          label={t('inventory:movementFields.note')}
          optional
          hint={t('inventory:movementFields.noteHint')}
          error={errorFor('note')}
        >
          <Textarea rows={2} {...register('note')} />
        </FormField>

        {canPostExpense ? (
          <div className="flex flex-col gap-3 rounded-md border border-line px-3 py-3">
            <p className="text-sm text-ink-secondary">
              {t('inventory:receiveDialog.expenseIntro')}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label={t('inventory:movementFields.expenseCategory')}
                optional
                error={serverFields.expenseCategoryId}
              >
                <Select
                  options={[
                    { value: '', label: t('inventory:movementFields.expenseNone') },
                    ...expenseOptions,
                  ]}
                  value={expenseCategoryId ?? ''}
                  {...register('expenseCategoryId')}
                />
              </FormField>
              <FormField label={t('inventory:movementFields.method')} error={serverFields.method}>
                <Select
                  options={methodOptions}
                  value={method ?? 'CASH'}
                  disabled={expenseCategoryId === ''}
                  {...register('method')}
                />
              </FormField>
            </div>
          </div>
        ) : null}

        {/*
          What is about to be recorded, in one sentence, before the button that records it. The
          figure is interpolated into a whole sentence rather than assembled from fragments around
          a component, because Kinyarwanda noun classes make a sentence built from pieces
          grammatically wrong. `formatQuantity` is what the `Quantity` component itself uses, and
          works on the string without parsing it into a number.
        */}
        {restatable && product ? (
          <p className="rounded-md border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-secondary">
            {t('inventory:receiveDialog.restate', {
              quantity: formatQuantity(quantity.trim(), product.unitSymbol),
              product: product.productName,
            })}
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}

/**
 * The select hands back a plain string. Narrowing it against the methods the server accepts means
 * a tampered option cannot travel any further than here, and cash is the sensible fallback.
 */
function readPaymentMethod(value: string): PaymentMethod {
  return PAYMENT_METHODS.find((candidate) => candidate === value) ?? 'CASH'
}
