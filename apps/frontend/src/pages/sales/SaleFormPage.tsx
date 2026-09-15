import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { formatMoney, formatQuantity } from '@coopmanage/shared'
import { PageHeader } from '@/components/PageHeader'
import {
  Alert,
  Button,
  FormField,
  Input,
  Money,
  Panel,
  SearchSelect,
  Select,
  Skeleton,
  Textarea,
  type SearchOption,
  type SelectOption,
} from '@/components/ui'
import {
  useProductLabel,
  useProductLookup,
  useWarehouses,
} from '@/features/inventory/inventory.hooks'
import {
  addMoney,
  compareMoney,
  exceedsQuantity,
  isMoney,
  isPositiveQuantity,
  isPrice,
  lineTotalOf,
  subtractMoney,
  type SaleDetail,
  type SaleInput,
  type SaleLineInput,
  type UpdateSaleInput,
} from '@/features/sales/sales.api'
import {
  todayIso,
  useBuyerLookup,
  useCreateSale,
  useSale,
  useSalesError,
  useSalesFieldError,
  useUpdateSale,
} from '@/features/sales/sales.hooks'

/**
 * Writing up a sale, and correcting one that is still a draft.
 *
 * **A draft is not a sale yet.** It takes no stock and records no money, which is why this form
 * saves without asking anybody to confirm anything, and why a line for more than the store holds
 * is a warning rather than a refusal: a sale is often written up at the counter before the sacks
 * have been counted, and the stock is checked in one transaction at confirmation.
 *
 * **The totals here are for reading, never for sending.** The subtotal, the discount, the tax and
 * the total are worked out on screen so the person at the counter can check them against what is
 * being agreed with the buyer, and none of them goes on the wire: the request carries the lines,
 * the discount and the tax, and the server prices the sale. Two figures that can disagree is one
 * figure too many, and the one on the receipt would be the one nobody checked. The arithmetic is
 * exact all the same — integer minor units, rounded per line exactly where the server rounds — so
 * the figure the counter reads and the figure in the books agree.
 *
 * **A discount larger than the lines is refused here, before any request.** It would make the sale
 * a negative amount and quietly spoil every report that sums sales. The server refuses it too, and
 * the message names the figure to come down to rather than leaving the reader to work it out.
 *
 * The scalar fields are held in plain state rather than in a form library, because the lines are a
 * list somebody adds to and removes from and the totals recompute on every keystroke; one source
 * of truth for all of it reads better than a form object and a list beside it.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Just enough of a product to price a line and warn about the stock. */
interface LineProduct {
  id: string
  name: string
  sku: string
  unitSymbol: string
  /** Across every store, and null for a product nobody counts rather than a zero. */
  quantityOnHand: string | null
}

interface LineDraft {
  /** Stable across renders, so removing the second line does not remount the third. */
  key: string
  product: LineProduct | null
  quantity: string
  unitPrice: string
  note: string
}

interface LineProblem {
  product?: string
  quantity?: string
  unitPrice?: string
}

interface Problems {
  buyer?: string
  warehouse?: string
  saleDate?: string
  lines?: string
  discount?: string
  tax?: string
  byLine: Record<string, LineProblem>
}

const NO_PROBLEMS: Problems = { byLine: {} }

let nextKey = 0

function emptyLine(): LineDraft {
  nextKey += 1
  return { key: `line-${nextKey}`, product: null, quantity: '', unitPrice: '', note: '' }
}

export function SaleFormPage() {
  const { t } = useTranslation(['sales', 'common'])
  const { id } = useParams<{ id: string }>()
  const describeError = useSalesError()
  const editing = id !== undefined

  const sale = useSale(id)

  if (editing && sale.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (editing && sale.isError) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink to="/sales" label={t('sales:form.backToSales')} />
        <Alert tone="danger" title={t('sales:form.loadFailed')}>
          {describeError(sale.error).message}
        </Alert>
      </div>
    )
  }

  const existing = editing ? (sale.data ?? null) : null

  /*
    Only a draft can be changed. The detail screen offers no edit control for a confirmed or
    cancelled sale, so this is what somebody sees when the sale moved on in another window while
    they had the form open — and it says what to do instead rather than failing on submit.
  */
  if (existing !== null && existing.status !== 'DRAFT') {
    return (
      <div className="flex flex-col gap-4">
        <BackLink to={`/sales/${existing.id}`} label={t('sales:form.backToSale')} />
        <Alert tone="warning" title={t('sales:form.notADraftTitle')}>
          {t('sales:form.notADraftBody')}
        </Alert>
      </div>
    )
  }

  // Keyed on the sale so the form mounts with its values already in place, which is what saves an
  // effect that would otherwise write the loaded sale into state after the first render.
  return <SaleForm key={existing?.id ?? 'new'} existing={existing} />
}

function SaleForm({ existing }: { existing: SaleDetail | null }) {
  const { t } = useTranslation(['sales', 'common'])
  const describeError = useSalesError()
  const fieldError = useSalesFieldError()
  const navigate = useNavigate()

  const create = useCreateSale()
  const update = useUpdateSale()
  const pending = create.isPending || update.isPending

  const warehouses = useWarehouses()

  const [buyer, setBuyer] = useState<SearchOption | null>(
    existing === null ? null : { value: existing.buyerId, label: existing.buyerName },
  )
  const [buyerQuery, setBuyerQuery] = useState('')
  const buyerLookup = useBuyerLookup(buyerQuery, buyer === null)

  /**
   * Which store the stock leaves from.
   *
   * Held as the reader's own choice, with the cooperative's default store standing in until they
   * choose otherwise, so no effect has to write a value into state after the stores have loaded.
   * A cooperative always keeps exactly one default, because stock has to come from somewhere.
   */
  const [storeChoice, setStoreChoice] = useState(existing?.warehouseId ?? '')
  const stores = warehouses.data ?? []
  const defaultStoreId = stores.find((store) => store.isDefault)?.id ?? ''
  const chosenStoreId = storeChoice || defaultStoreId

  const [saleDate, setSaleDate] = useState(existing?.saleDate ?? todayIso())
  const [note, setNote] = useState(existing?.note ?? '')
  const [discount, setDiscount] = useState(
    existing === null || existing.discount === '0.00' ? '' : existing.discount,
  )
  const [tax, setTax] = useState(
    existing === null || existing.taxAmount === '0.00' ? '' : existing.taxAmount,
  )

  const [lines, setLines] = useState<LineDraft[]>(() => {
    if (existing === null) return [emptyLine()]
    return existing.lines.map((line) => {
      nextKey += 1
      return {
        key: `line-${nextKey}`,
        product: {
          id: line.productId,
          name: line.productName,
          sku: line.sku,
          unitSymbol: line.unitSymbol,
          // The sale does not carry what is on hand, so a line that arrived with the draft cannot
          // be warned about until its product is chosen again. The check that matters happens at
          // confirmation, inside the transaction, where the figure cannot be stale.
          quantityOnHand: null,
        },
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        note: line.note ?? '',
      }
    })
  })

  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS)

  const failed = create.error ?? update.error
  const described = failed ? describeError(failed) : null
  const serverFields = described?.fieldErrors ?? {}

  function patchLine(key: string, changes: Partial<LineDraft>): void {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...changes } : line)),
    )
  }

  function removeLine(key: string): void {
    setLines((current) => (current.length === 1 ? current : current.filter((l) => l.key !== key)))
  }

  /**
   * The figures on screen.
   *
   * A line with no product or an unreadable quantity contributes nothing rather than breaking the
   * arithmetic, so the total is always readable while somebody is still typing. Every step is over
   * exact integer minor units and each line is rounded once, where the server rounds it.
   */
  const lineTotals = lines.map((line) =>
    line.product !== null && isPositiveQuantity(line.quantity) && isPrice(line.unitPrice)
      ? lineTotalOf(line.unitPrice.trim(), line.quantity.trim())
      : '0.00',
  )
  const subtotal = addMoney(...lineTotals)
  const readableDiscount = discount.trim() !== '' && isMoney(discount) ? discount.trim() : '0.00'
  const readableTax = tax.trim() !== '' && isMoney(tax) ? tax.trim() : '0.00'
  const total = addMoney(subtractMoney(subtotal, readableDiscount), readableTax)

  function validate(): { body: SaleLineInput[]; problems: Problems } {
    const found: Problems = { byLine: {} }
    const chosen = lines.filter((line) => line.product !== null)

    if (buyer === null) found.buyer = t('sales:formErrors.buyer')
    if (chosenStoreId === '') found.warehouse = t('sales:formErrors.warehouse')
    if (!DATE_ONLY.test(saleDate)) found.saleDate = t('sales:formErrors.saleDate')
    if (chosen.length === 0) found.lines = t('sales:formErrors.noLines')

    for (const line of lines) {
      const problem: LineProblem = {}
      // A line nobody filled in at all is simply dropped; one with a quantity but no product is a
      // mistake worth naming, because the reader plainly meant to sell something.
      const touched =
        line.product !== null || line.quantity.trim() !== '' || line.unitPrice.trim() !== ''
      if (!touched) continue
      if (line.product === null) problem.product = t('sales:formErrors.product')
      if (!isPositiveQuantity(line.quantity)) problem.quantity = t('sales:formErrors.quantity')
      if (!isPrice(line.unitPrice)) problem.unitPrice = t('sales:formErrors.unitPrice')
      if (Object.keys(problem).length > 0) found.byLine[line.key] = problem
    }

    if (discount.trim() !== '' && !isMoney(discount)) {
      found.discount = t('sales:formErrors.discount')
    } else if (compareMoney(readableDiscount, subtotal) > 0) {
      // Refused here rather than by the server, so the reader is told the figure to come down to.
      found.discount = t('sales:formErrors.discountTooLarge', {
        subtotal: formatMoney(subtotal),
      })
    }

    if (tax.trim() !== '' && !isMoney(tax)) found.tax = t('sales:formErrors.tax')

    const body: SaleLineInput[] = chosen.map((line) => ({
      productId: line.product?.id ?? '',
      // The characters the reader typed, unchanged. Never a JavaScript number.
      quantity: line.quantity.trim(),
      unitPrice: line.unitPrice.trim(),
      ...(line.note.trim() ? { note: line.note.trim() } : {}),
    }))

    return { body, problems: found }
  }

  function submit(): void {
    const { body, problems: found } = validate()
    const blocked =
      found.buyer !== undefined ||
      found.warehouse !== undefined ||
      found.saleDate !== undefined ||
      found.lines !== undefined ||
      found.discount !== undefined ||
      found.tax !== undefined ||
      Object.keys(found.byLine).length > 0

    setProblems(found)
    if (blocked || buyer === null) return

    if (existing === null) {
      const input: SaleInput = {
        buyerId: buyer.value,
        warehouseId: chosenStoreId,
        saleDate,
        lines: body,
        ...(readableDiscount === '0.00' ? {} : { discount: readableDiscount }),
        ...(readableTax === '0.00' ? {} : { taxAmount: readableTax }),
        ...(note.trim() ? { note: note.trim() } : {}),
      }
      create.mutate(input, {
        onSuccess: (result) => void navigate(`/sales/${result.id}`),
      })
      return
    }

    // The lines are replaced wholesale rather than patched one at a time, because a sale is read
    // and corrected as a whole and a line-by-line protocol would leave the subtotal disagreeing
    // with the lines between two requests.
    const changes: UpdateSaleInput = {
      buyerId: buyer.value,
      warehouseId: chosenStoreId,
      saleDate,
      lines: body,
      discount: readableDiscount,
      taxAmount: readableTax,
      ...(note.trim() ? { note: note.trim() } : {}),
    }
    update.mutate(
      { id: existing.id, changes },
      { onSuccess: () => void navigate(`/sales/${existing.id}`) },
    )
  }

  const storeOptions: SelectOption[] = stores
    .filter((store) => store.isActive)
    .map((store) => ({ value: store.id, label: store.name }))

  const buyerOptions: SearchOption[] = (buyerLookup.data?.items ?? []).map((row) => ({
    value: row.id,
    label: row.name,
    hint: row.organization ?? row.phone ?? undefined,
  }))

  return (
    <div className="flex flex-col gap-6">
      <BackLink
        to={existing === null ? '/sales' : `/sales/${existing.id}`}
        label={existing === null ? t('sales:form.backToSales') : t('sales:form.backToSale')}
      />

      <PageHeader
        title={
          existing === null
            ? t('sales:form.newTitle')
            : t('sales:form.editTitle', { reference: existing.reference })
        }
        description={
          existing === null ? t('sales:form.newDescription') : t('sales:form.editDescription')
        }
      />

      <form
        id="sale-form"
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {described ? <Alert tone="danger">{described.message}</Alert> : null}

        <Panel title={t('sales:form.buyer')}>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              label={t('sales:form.buyer')}
              error={problems.buyer ?? fieldError(serverFields, 'buyerId')}
            >
              <SearchSelect
                value={buyer}
                onChange={setBuyer}
                options={buyerOptions}
                query={buyerQuery}
                onQueryChange={setBuyerQuery}
                loading={buyerLookup.isFetching}
                placeholder={t('sales:form.buyerPlaceholder')}
                emptyLabel={t('sales:form.buyerEmpty')}
                loadingLabel={t('sales:form.buyerLoading')}
                clearLabel={t('sales:form.buyerClear')}
              />
            </FormField>

            <FormField
              label={t('sales:form.warehouse')}
              error={problems.warehouse ?? fieldError(serverFields, 'warehouseId')}
            >
              <Select
                options={storeOptions}
                placeholder={t('sales:form.warehousePlaceholder')}
                value={chosenStoreId}
                onChange={(event) => setStoreChoice(event.target.value)}
              />
            </FormField>

            <FormField
              label={t('sales:form.saleDate')}
              hint={t('sales:form.saleDateHint')}
              error={problems.saleDate ?? fieldError(serverFields, 'saleDate')}
            >
              <Input
                type="date"
                value={saleDate}
                onChange={(event) => setSaleDate(event.target.value)}
              />
            </FormField>
          </div>
        </Panel>

        <Panel
          title={t('sales:form.linesTitle')}
          description={t('sales:form.linesDescription')}
          actions={
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => setLines((current) => [...current, emptyLine()])}
            >
              {t('sales:form.addLine')}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            {problems.lines ? <Alert tone="warning">{problems.lines}</Alert> : null}

            {lines.map((line, index) => (
              <LineFields
                key={line.key}
                line={line}
                position={index + 1}
                lineTotal={lineTotals[index] ?? '0.00'}
                problem={problems.byLine[line.key]}
                canRemove={lines.length > 1}
                onChange={(changes) => patchLine(line.key, changes)}
                onRemove={() => removeLine(line.key)}
              />
            ))}
          </div>
        </Panel>

        <Panel title={t('sales:form.totalsTitle')}>
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label={t('sales:form.discount')}
                optional
                hint={t('sales:form.discountHint')}
                error={problems.discount ?? fieldError(serverFields, 'discount')}
              >
                <Input
                  inputMode="decimal"
                  autoComplete="off"
                  value={discount}
                  onChange={(event) => setDiscount(event.target.value)}
                />
              </FormField>

              <FormField
                label={t('sales:form.tax')}
                optional
                hint={t('sales:form.taxHint')}
                error={problems.tax ?? fieldError(serverFields, 'taxAmount')}
              >
                <Input
                  inputMode="decimal"
                  autoComplete="off"
                  value={tax}
                  onChange={(event) => setTax(event.target.value)}
                />
              </FormField>
            </div>

            <dl className="flex flex-col gap-1.5 rounded-md border border-line bg-surface-subtle px-3 py-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-secondary">{t('sales:form.subtotal')}</dt>
                <dd>
                  <Money value={subtotal} />
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-secondary">{t('sales:form.discount')}</dt>
                <dd>
                  <Money value={readableDiscount} />
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-secondary">{t('sales:form.tax')}</dt>
                <dd>
                  <Money value={readableTax} />
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-line pt-1.5 text-base font-semibold">
                <dt>{t('sales:form.total')}</dt>
                <dd>
                  <Money value={total} />
                </dd>
              </div>
            </dl>

            {/* Said outright, because a reader checking a figure needs to know which side of the
                wire it came from. */}
            <p className="text-sm text-ink-muted">{t('sales:form.computedNote')}</p>

            <FormField
              label={t('sales:form.note')}
              optional
              hint={t('sales:form.noteHint')}
              error={fieldError(serverFields, 'note')}
            >
              <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
            </FormField>
          </div>
        </Panel>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" asChild>
            <Link to={existing === null ? '/sales' : `/sales/${existing.id}`}>
              {/* The shared "Cancel" is safe here: this abandons a form, it does not cancel a
                  sale, so nothing meaning the opposite sits beside it. */}
              {t('common:actions.cancel')}
            </Link>
          </Button>
          <Button type="submit" form="sale-form" loading={pending}>
            {existing === null ? t('sales:form.save') : t('sales:form.saveChanges')}
          </Button>
        </div>
      </form>
    </div>
  )
}

/**
 * One line of the sale.
 *
 * A component of its own rather than markup in a loop, because each line owns a product search and
 * a search needs its own query state and its own request. The over-stock warning is a warning and
 * nothing more: it does not disable the button, because a draft written up before the sacks have
 * been counted is a legitimate draft and the check that decides the matter happens inside the
 * confirmation transaction.
 */
function LineFields({
  line,
  position,
  lineTotal,
  problem,
  canRemove,
  onChange,
  onRemove,
}: {
  line: LineDraft
  position: number
  lineTotal: string
  problem: LineProblem | undefined
  canRemove: boolean
  onChange: (changes: Partial<LineDraft>) => void
  onRemove: () => void
}) {
  const { t } = useTranslation(['sales', 'common'])
  const productLabel = useProductLabel()

  const [query, setQuery] = useState('')
  // Services have no stock and are sold like anything else, so the picker is not narrowed to what
  // is counted the way the movement dialogs narrow theirs.
  const lookup = useProductLookup(query, line.product === null, false)

  const productOptions: SearchOption[] = (lookup.data?.items ?? []).map((row) => ({
    value: row.id,
    label: productLabel(row),
    hint:
      row.quantityOnHand === null
        ? t('sales:form.productHintUncounted', { sku: row.sku })
        : t('sales:form.productHint', {
            sku: row.sku,
            onHand: formatQuantity(row.quantityOnHand, row.unitSymbol),
          }),
  }))

  const onHand = line.product?.quantityOnHand ?? null
  const overStock =
    onHand !== null &&
    isPositiveQuantity(line.quantity) &&
    exceedsQuantity(line.quantity.trim(), onHand)

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-line px-3 py-3">
      <legend className="px-1 text-sm font-medium text-ink-secondary">
        {t('sales:form.lineNumber', { position })}
      </legend>

      <div className="grid gap-4 lg:grid-cols-4">
        <FormField
          label={t('sales:form.product')}
          error={problem?.product}
          className="lg:col-span-2"
        >
          {line.product === null ? (
            <SearchSelect
              value={null}
              onChange={(option) => {
                if (!option) return
                const found = (lookup.data?.items ?? []).find((row) => row.id === option.value)
                if (!found) return
                onChange({
                  product: {
                    id: found.id,
                    name: productLabel(found),
                    sku: found.sku,
                    unitSymbol: found.unitSymbol,
                    quantityOnHand: found.quantityOnHand,
                  },
                  // The catalogue's own price stands in, because that is what is charged unless
                  // somebody has agreed otherwise, and retyping it every time invites a slip.
                  unitPrice: line.unitPrice || (found.defaultSalePrice ?? ''),
                })
              }}
              options={productOptions}
              query={query}
              onQueryChange={setQuery}
              loading={lookup.isFetching}
              placeholder={t('sales:form.productPlaceholder')}
              emptyLabel={t('sales:form.productEmpty')}
              loadingLabel={t('sales:form.productLoading')}
              clearLabel={t('sales:form.productClear')}
            />
          ) : (
            <div className="rounded-md border border-line bg-surface-subtle px-3 py-2">
              <p className="text-base text-ink">{line.product.name}</p>
              <p className="text-sm text-ink-muted">
                {line.product.quantityOnHand === null
                  ? t('sales:form.productHintUncounted', { sku: line.product.sku })
                  : t('sales:form.productHint', {
                      sku: line.product.sku,
                      onHand: formatQuantity(line.product.quantityOnHand, line.product.unitSymbol),
                    })}
              </p>
              <Button variant="link" size="sm" onClick={() => onChange({ product: null })}>
                {t('sales:form.changeProduct')}
              </Button>
            </div>
          )}
        </FormField>

        <FormField
          label={t('sales:form.quantity')}
          hint={
            line.product
              ? t('sales:form.quantityHintUnit', { unit: line.product.unitSymbol })
              : t('sales:form.quantityHint')
          }
          error={problem?.quantity}
        >
          {/* `inputMode` rather than `type="number"`: a number input rounds, spins and localises
              the decimal separator, none of which a weight can survive. */}
          <Input
            inputMode="decimal"
            autoComplete="off"
            value={line.quantity}
            onChange={(event) => onChange({ quantity: event.target.value })}
          />
        </FormField>

        <FormField
          label={t('sales:form.unitPrice')}
          hint={t('sales:form.unitPriceHint')}
          error={problem?.unitPrice}
        >
          <Input
            inputMode="decimal"
            autoComplete="off"
            value={line.unitPrice}
            onChange={(event) => onChange({ unitPrice: event.target.value })}
          />
        </FormField>
      </div>

      <FormField label={t('sales:form.lineNote')} optional>
        <Input
          autoComplete="off"
          value={line.note}
          onChange={(event) => onChange({ note: event.target.value })}
        />
      </FormField>

      {overStock && onHand !== null ? (
        <Alert tone="warning">
          {t('sales:form.overStockWarning', {
            onHand: formatQuantity(onHand, line.product?.unitSymbol),
            asked: formatQuantity(line.quantity.trim(), line.product?.unitSymbol),
          })}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* One sentence with the figure interpolated into it, rather than a label beside a
            component, because Kinyarwanda noun classes make a sentence built from pieces wrong. */}
        <p className="text-sm text-ink-secondary">
          {t('sales:form.lineTotal', { amount: formatMoney(lineTotal) })}
        </p>
        {canRemove ? (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<Trash2 aria-hidden="true" className="size-4" />}
            onClick={onRemove}
          >
            {t('sales:form.removeLine')}
          </Button>
        ) : null}
      </div>
    </fieldset>
  )
}

function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      {label}
    </Link>
  )
}
