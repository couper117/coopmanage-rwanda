import {
  Coins,
  Download,
  FileSpreadsheet,
  MinusCircle,
  PlusCircle,
  SearchX,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '@coopmanage/shared'
import { PageHeader } from '@/components/PageHeader'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  Input,
  Money,
  Panel,
  Select,
  Textarea,
  type Column,
  type SelectOption,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { RecordEntryDialog } from '@/features/finance/RecordEntryDialog'
import {
  countActiveLedgerFilters,
  FINANCE_KINDS,
  FINANCE_SORTS,
  FINANCE_STATUSES,
  isMemberSourced,
  PAYMENT_METHODS,
  type FinanceKind,
  type FinanceSort,
  type FinanceStatus,
  type PaymentMethod,
  type TransactionRow,
} from '@/features/finance/finance.api'
import {
  useCategoryLabel,
  useDebouncedValue,
  useExportFinance,
  useFinanceCategories,
  useFinanceError,
  useFormatNumber,
  useFormatDate,
  useLedgerFilters,
  useTransactionsList,
  useUpdateTransaction,
  useVoidTransaction,
} from '@/features/finance/finance.hooks'

/**
 * Every movement of money the cooperative has recorded.
 *
 * This is the working screen of the finance module: an accountant narrows it to a category and a
 * month, reads the total at the bottom, and takes the same set away as a file. So the filters live
 * in the URL, the total in the footer covers the whole filtered set rather than the page on
 * screen, and the two ways of adding an entry are named for what they do rather than sharing one
 * button with a toggle inside it.
 *
 * Three things this screen never does.
 *
 * **It never deletes.** A wrong entry is voided, which writes a reversal and leaves both rows
 * visible, so a figure never silently changes between one month's report and the next.
 *
 * **It never edits a figure.** Only the category and the description of a posted entry can be
 * changed. The amount, the kind and the date are fixed for good, which is what makes last year's
 * printed report still true.
 *
 * **It never offers a control the server would refuse.** An entry that came from a member's
 * contribution or share purchase is cancelled from the member's own record, so the void control
 * is replaced with a sentence saying where to go. Every control on this screen is also hidden when
 * the permission behind it is absent — which is a courtesy to the reader and not the security
 * boundary: the server checks each of these permissions again on every request regardless of what
 * the interface chose to show.
 */

const AMOUNT_FILTER = /^\d{1,12}(\.\d{1,2})?$/

export function LedgerPage() {
  const { t } = useTranslation(['finance', 'common'])
  const describeError = useFinanceError()
  const formatDate = useFormatDate()
  const formatNumber = useFormatNumber()
  const categoryLabel = useCategoryLabel()

  const canCreate = usePermission('finance:create')
  const canVoid = usePermission('finance:void')
  const canExport = usePermission('finance:export')

  const { filters, patch, clear } = useLedgerFilters()
  const list = useTransactionsList(filters)
  const categories = useFinanceCategories({ includeInactive: true })
  const exportLedger = useExportFinance()
  const voidEntry = useVoidTransaction()
  const updateEntry = useUpdateTransaction()

  const [showFilters, setShowFilters] = useState(() => countActiveLedgerFilters(filters) > 0)
  const [recording, setRecording] = useState<FinanceKind | null>(null)
  const [editing, setEditing] = useState<TransactionRow | null>(null)
  const [editCategoryId, setEditCategoryId] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [voiding, setVoiding] = useState<TransactionRow | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // These three fields keep their own value so typing stays instant; the URL is only rewritten
  // once typing has stopped, which is also what stops one request going out per keystroke.
  const [search, setSearch] = useState(filters.q)
  const debouncedSearch = useDebouncedValue(search, 300)
  const [minAmount, setMinAmount] = useState(filters.minAmount)
  const debouncedMin = useDebouncedValue(minAmount, 400)
  const [maxAmount, setMaxAmount] = useState(filters.maxAmount)
  const debouncedMax = useDebouncedValue(maxAmount, 400)

  useEffect(() => {
    if (debouncedSearch.trim() === filters.q) return
    patch({ q: debouncedSearch.trim() })
  }, [debouncedSearch, filters.q, patch])

  useEffect(() => {
    const next = readAmountFilter(debouncedMin)
    if (next === filters.minAmount) return
    patch({ minAmount: next })
  }, [debouncedMin, filters.minAmount, patch])

  useEffect(() => {
    const next = readAmountFilter(debouncedMax)
    if (next === filters.maxAmount) return
    patch({ maxAmount: next })
  }, [debouncedMax, filters.maxAmount, patch])

  const rows = list.data?.items ?? []
  const meta = list.data?.meta
  const totals = list.data?.totals
  const activeFilters = countActiveLedgerFilters(filters)
  const filtersApplied = activeFilters > 0

  function clearEverything(): void {
    setSearch('')
    setMinAmount('')
    setMaxAmount('')
    clear()
  }

  const categoryRows = categories.data ?? []

  const kindOptions: SelectOption[] = [
    { value: '', label: t('finance:filters.anyKind') },
    ...FINANCE_KINDS.map((value) => ({ value, label: t(`finance:kind.${value}`) })),
  ]
  const methodOptions: SelectOption[] = [
    { value: '', label: t('finance:filters.anyMethod') },
    ...PAYMENT_METHODS.map((value) => ({ value, label: t(`finance:method.${value}`) })),
  ]
  const statusOptions: SelectOption[] = [
    { value: '', label: t('finance:filters.anyStatus') },
    ...FINANCE_STATUSES.map((value) => ({ value, label: t(`finance:status.${value}`) })),
  ]
  const categoryOptions: SelectOption[] = [
    { value: '', label: t('finance:filters.anyCategory') },
    ...categoryRows.map((row) => ({ value: row.id, label: categoryLabel(row) })),
  ]
  const sortOptions: SelectOption[] = FINANCE_SORTS.map((value) => ({
    value,
    label: t(`finance:sort.${value}`),
  }))

  /** The categories an entry can be moved to: the same kind, and still in use. */
  const editCategoryOptions: SelectOption[] = categoryRows
    .filter((row) => editing !== null && row.kind === editing.kind && row.isActive)
    .map((row) => ({ value: row.id, label: categoryLabel(row) }))

  const columns: Column<TransactionRow>[] = [
    {
      key: 'reference',
      header: t('finance:columns.reference'),
      render: (row) => (
        <div className="min-w-0">
          <span className="block font-medium text-ink">{row.reference}</span>
          {row.sourceType !== 'MANUAL' ? (
            <span className="block text-xs text-ink-muted">
              {t(`finance:source.${row.sourceType}`, { defaultValue: row.sourceType })}
            </span>
          ) : null}
          {row.reversalOfReference ? (
            <span className="block text-xs text-ink-muted">
              {t('finance:entry.correctionOf', { reference: row.reversalOfReference })}
            </span>
          ) : null}
          {row.reversedByReference ? (
            <span className="block text-xs text-ink-muted">
              {t('finance:entry.correctedBy', { reference: row.reversedByReference })}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'occurredAt',
      header: t('finance:columns.occurredAt'),
      render: (row) => formatDate(row.occurredAt),
    },
    {
      key: 'category',
      header: t('finance:columns.category'),
      render: (row) => categoryLabel({ name: row.categoryName, nameRw: row.categoryNameRw }),
    },
    {
      key: 'description',
      header: t('finance:columns.description'),
      render: (row) => <span className="block max-w-72 truncate">{row.description}</span>,
    },
    {
      key: 'member',
      header: t('finance:columns.member'),
      secondary: true,
      render: (row) =>
        row.memberName === null ? (
          <span className="text-ink-muted">{t('finance:entry.noMember')}</span>
        ) : (
          <div className="min-w-0">
            <span className="block truncate text-ink">{row.memberName}</span>
            <span className="block text-xs text-ink-muted">{row.memberCode}</span>
          </div>
        ),
    },
    {
      key: 'method',
      header: t('finance:columns.method'),
      secondary: true,
      render: (row) => t(`finance:method.${row.method}`, { defaultValue: row.method }),
    },
    {
      key: 'amount',
      header: t('finance:columns.amount'),
      align: 'right',
      // `Money`'s tone adds a sign as well as a colour, so money in and money out are told apart
      // on a monochrome printout and by a reader who cannot distinguish red from green.
      render: (row) => (
        <Money
          value={row.amount}
          tone={row.status === 'VOID' ? 'neutral' : row.kind === 'INCOME' ? 'in' : 'out'}
        />
      ),
    },
    {
      key: 'status',
      header: t('finance:columns.status'),
      render: (row) => (
        <Badge tone={row.status === 'VOID' ? 'neutral' : 'success'}>
          {t(`finance:status.${row.status}`, { defaultValue: row.status })}
        </Badge>
      ),
    },
  ]

  if (canCreate || canVoid) {
    columns.push({
      key: 'actions',
      header: t('finance:columns.actions'),
      align: 'right',
      width: '13rem',
      render: (row) => {
        if (row.status === 'VOID') return null
        return (
          <div className="flex flex-wrap items-center justify-end gap-1">
            {canCreate ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setNotice(null)
                  updateEntry.reset()
                  setEditCategoryId(row.categoryId)
                  setEditDescription(row.description)
                  setEditing(row)
                }}
              >
                {t('common:actions.edit')}
              </Button>
            ) : null}
            {isMemberSourced(row.sourceType) ? (
              /* No void control at all for these: the ledger row and the member's record are two
                 views of the same money, and voiding one side would leave the other claiming
                 money the books no longer hold. The server refuses it too. */
              <span className="text-xs text-ink-muted">{t('finance:entry.cancelAtSource')}</span>
            ) : canVoid ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setNotice(null)
                  voidEntry.reset()
                  setReason('')
                  setReasonError(null)
                  setVoiding(row)
                }}
              >
                {t('finance:void.action')}
              </Button>
            ) : null}
          </div>
        )
      },
    })
  }

  function submitVoid(): void {
    if (!voiding) return
    const trimmed = reason.trim()
    if (trimmed.length === 0) {
      // A void with no reason is the entry an auditor asks about first.
      setReasonError(t('finance:void.reasonRequired'))
      return
    }
    voidEntry.mutate(
      { id: voiding.id, reason: trimmed },
      {
        onSuccess: (result) => {
          setNotice(
            t('finance:void.done', {
              reference: result.voided.reference,
              reversal: result.reversal.reference,
            }),
          )
          setVoiding(null)
          setReason('')
        },
      },
    )
  }

  function submitEdit(): void {
    if (!editing) return
    const description = editDescription.trim()
    if (description.length === 0) return
    updateEntry.mutate(
      { id: editing.id, changes: { categoryId: editCategoryId, description } },
      {
        onSuccess: (saved) => {
          setNotice(t('finance:entry.updated', { reference: saved.reference }))
          setEditing(null)
        },
      },
    )
  }

  const from = meta ? (meta.page - 1) * meta.pageSize + 1 : 0
  const to = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('finance:ledger.title')}
        description={t('finance:ledger.description')}
        actions={
          <>
            {canExport ? (
              <>
                {/* Two formats, because they are used for different things: the CSV opens
                    anywhere, and the workbook is what an accountant wants when the first thing
                    they do is select the amount column and read the sum. */}
                <Button
                  variant="secondary"
                  leadingIcon={<Download aria-hidden="true" className="size-4" />}
                  loading={exportLedger.isPending}
                  onClick={() => exportLedger.mutate({ filters, format: 'csv' })}
                >
                  {t('finance:ledger.exportCsv')}
                </Button>
                <Button
                  variant="secondary"
                  leadingIcon={<FileSpreadsheet aria-hidden="true" className="size-4" />}
                  loading={exportLedger.isPending}
                  onClick={() => exportLedger.mutate({ filters, format: 'xlsx' })}
                >
                  {t('finance:ledger.exportExcel')}
                </Button>
              </>
            ) : null}
            {canCreate ? (
              <>
                <Button
                  leadingIcon={<PlusCircle aria-hidden="true" className="size-4" />}
                  onClick={() => {
                    setNotice(null)
                    setRecording('INCOME')
                  }}
                >
                  {t('finance:ledger.recordIn')}
                </Button>
                <Button
                  variant="secondary"
                  leadingIcon={<MinusCircle aria-hidden="true" className="size-4" />}
                  onClick={() => {
                    setNotice(null)
                    setRecording('EXPENSE')
                  }}
                >
                  {t('finance:ledger.recordOut')}
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {notice ? (
        <Alert
          tone="success"
          action={
            <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
              {t('common:actions.close')}
            </Button>
          }
        >
          {notice}
        </Alert>
      ) : null}

      {exportLedger.isError ? (
        <Alert tone="danger" title={t('finance:ledger.exportFailed')}>
          {describeError(exportLedger.error).message}
        </Alert>
      ) : null}

      <Panel flush>
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <FormField label={t('finance:search.label')} className="min-w-56 flex-1">
              <Input
                type="search"
                placeholder={t('finance:search.placeholder')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </FormField>

            <FormField label={t('finance:filters.kind')} className="w-44">
              <Select
                options={kindOptions}
                value={filters.kind}
                onChange={(event) => patch({ kind: readKind(event.target.value) })}
              />
            </FormField>

            <FormField label={t('finance:filters.category')} className="w-52">
              <Select
                options={categoryOptions}
                value={filters.categoryId}
                onChange={(event) => patch({ categoryId: event.target.value })}
              />
            </FormField>

            <FormField label={t('finance:sort.label')} className="w-56">
              <Select
                options={sortOptions}
                value={filters.sort}
                onChange={(event) => patch({ sort: readSort(event.target.value) })}
              />
            </FormField>

            <Button
              variant="secondary"
              aria-expanded={showFilters}
              aria-controls="finance-more-filters"
              leadingIcon={<SlidersHorizontal aria-hidden="true" className="size-4" />}
              onClick={() => setShowFilters((open) => !open)}
            >
              {activeFilters > 0
                ? t('finance:filters.showWithCount', { total: activeFilters })
                : t('finance:filters.show')}
            </Button>

            {filtersApplied ? (
              <Button
                variant="ghost"
                leadingIcon={<X aria-hidden="true" className="size-4" />}
                onClick={clearEverything}
              >
                {t('common:actions.clearFilters')}
              </Button>
            ) : null}
          </div>

          <div
            id="finance-more-filters"
            hidden={!showFilters}
            className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            <FormField label={t('finance:filters.from')}>
              <Input
                type="date"
                value={filters.from}
                onChange={(event) => patch({ from: event.target.value })}
              />
            </FormField>
            <FormField label={t('finance:filters.to')}>
              <Input
                type="date"
                value={filters.to}
                onChange={(event) => patch({ to: event.target.value })}
              />
            </FormField>
            <FormField label={t('finance:filters.method')}>
              <Select
                options={methodOptions}
                value={filters.method}
                onChange={(event) => patch({ method: readMethod(event.target.value) })}
              />
            </FormField>
            <FormField label={t('finance:filters.status')}>
              <Select
                options={statusOptions}
                value={filters.status}
                onChange={(event) => patch({ status: readStatus(event.target.value) })}
              />
            </FormField>
            <FormField
              label={t('finance:filters.minAmount')}
              hint={t('finance:filters.amountHint')}
            >
              <Input
                inputMode="decimal"
                value={minAmount}
                onChange={(event) => setMinAmount(event.target.value)}
              />
            </FormField>
            <FormField
              label={t('finance:filters.maxAmount')}
              hint={t('finance:filters.amountHint')}
            >
              <Input
                inputMode="decimal"
                value={maxAmount}
                onChange={(event) => setMaxAmount(event.target.value)}
              />
            </FormField>
          </div>
        </div>

        {list.isError ? (
          <div className="p-4">
            <Alert
              tone="danger"
              title={t('finance:ledger.loadFailed')}
              action={
                <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
                  {t('common:actions.retry')}
                </Button>
              }
            >
              {describeError(list.error).message}
            </Alert>
          </div>
        ) : (
          <>
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(row) => row.id}
              caption={t('finance:ledger.caption')}
              loading={list.isPending}
              rowMuted={(row) => row.status === 'VOID'}
              footer={
                totals ? (
                  /* One cell across the table: the three figures belong together as a sentence
                     about the filter, not as three numbers under three unrelated columns. */
                  <td colSpan={columns.length} className="px-3 py-2 text-sm">
                    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span>
                        {t('finance:ledger.totalIn')} <Money value={totals.income} tone="in" />
                      </span>
                      <span>
                        {t('finance:ledger.totalOut')} <Money value={totals.expenses} tone="out" />
                      </span>
                      <span>
                        {t('finance:ledger.totalBalance')} <Money value={totals.balance} />
                      </span>
                      <span className="text-ink-muted">{t('finance:ledger.totalsCover')}</span>
                    </span>
                  </td>
                ) : undefined
              }
              empty={
                filtersApplied ? (
                  <EmptyState
                    icon={SearchX}
                    title={t('finance:ledger.emptyFilteredTitle')}
                    description={t('finance:ledger.emptyFilteredBody')}
                    action={
                      <Button variant="secondary" onClick={clearEverything}>
                        {t('common:actions.clearFilters')}
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon={Coins}
                    title={t('finance:ledger.emptyTitle')}
                    description={t('finance:ledger.emptyBody')}
                    action={
                      canCreate ? (
                        <Button onClick={() => setRecording('INCOME')}>
                          {t('finance:ledger.recordIn')}
                        </Button>
                      ) : undefined
                    }
                  />
                )
              }
              mobileRow={(row) => (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{row.reference}</span>
                    <Money
                      value={row.amount}
                      tone={
                        row.status === 'VOID' ? 'neutral' : row.kind === 'INCOME' ? 'in' : 'out'
                      }
                    />
                  </div>
                  <p className="text-sm text-ink">{row.description}</p>
                  <p className="text-sm text-ink-muted">
                    {formatDate(row.occurredAt)} ·{' '}
                    {categoryLabel({ name: row.categoryName, nameRw: row.categoryNameRw })}
                  </p>
                  <Badge tone={row.status === 'VOID' ? 'neutral' : 'success'}>
                    {t(`finance:status.${row.status}`, { defaultValue: row.status })}
                  </Badge>
                </div>
              )}
            />

            {meta && meta.total > 0 && !list.isPending ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
                <p className="text-sm text-ink-muted">
                  {t('finance:pagination.summary', {
                    from: formatNumber(from),
                    to: formatNumber(to),
                    total: formatNumber(meta.total),
                  })}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={meta.page <= 1}
                    onClick={() => patch({ page: Math.max(1, meta.page - 1) })}
                  >
                    {t('common:actions.previous')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={meta.page >= meta.totalPages}
                    onClick={() => patch({ page: meta.page + 1 })}
                  >
                    {t('common:actions.next')}
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Panel>

      {recording !== null ? (
        <RecordEntryDialog
          open
          kind={recording}
          onOpenChange={(open) => {
            if (!open) setRecording(null)
          }}
          onRecorded={(result) =>
            setNotice(
              t('finance:ledger.recorded', {
                // Grouped and stripped of meaningless trailing zeros, the way every other
                // amount on the screen reads. `formatMoney` works on the string itself.
                amount: formatMoney(result.amount),
                reference: result.reference,
              }),
            )
          }
        />
      ) : null}

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        width="sm"
        busy={updateEntry.isPending}
        title={t('finance:entry.editTitle')}
        description={
          editing ? t('finance:entry.editDescription', { reference: editing.reference }) : undefined
        }
        footer={
          <>
            <Button
              variant="secondary"
              disabled={updateEntry.isPending}
              onClick={() => setEditing(null)}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={submitEdit} loading={updateEntry.isPending}>
              {t('common:actions.save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {/* Said outright, because a reader looking for the amount field needs to know it was
              withheld deliberately rather than forgotten. */}
          <p className="text-sm text-ink-muted">{t('finance:entry.editFixed')}</p>
          <FormField label={t('finance:entryFields.category')}>
            <Select
              options={editCategoryOptions}
              value={editCategoryId}
              onChange={(event) => setEditCategoryId(event.target.value)}
            />
          </FormField>
          <FormField label={t('finance:entryFields.description')}>
            <Textarea
              rows={3}
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
            />
          </FormField>
          {updateEntry.isError ? (
            <Alert tone="danger">{describeError(updateEntry.error).message}</Alert>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) {
            setVoiding(null)
            setReason('')
            setReasonError(null)
          }
        }}
        width="sm"
        busy={voidEntry.isPending}
        title={t('finance:void.title')}
        description={
          voiding
            ? t('finance:void.description', {
                reference: voiding.reference,
                amount: formatMoney(voiding.amount),
              })
            : undefined
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setVoiding(null)}
              disabled={voidEntry.isPending}
            >
              {/* Not the shared "Cancel", which here would sit next to "Cancel the entry" and
                  mean the opposite of it. */}
              {t('finance:void.keep')}
            </Button>
            <Button variant="danger" onClick={submitVoid} loading={voidEntry.isPending}>
              {t('finance:void.confirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">{t('finance:void.consequence')}</p>
          <FormField
            label={t('finance:void.reason')}
            hint={t('finance:void.reasonHint')}
            error={reasonError ?? undefined}
          >
            <Textarea
              rows={3}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                setReasonError(null)
              }}
            />
          </FormField>
          {voidEntry.isError ? (
            <Alert tone="danger">{describeError(voidEntry.error).message}</Alert>
          ) : null}
        </div>
      </Dialog>
    </div>
  )
}

/**
 * The select elements hand back a plain string. These four narrow it against the values the
 * server accepts, so a hand-edited option in the address bar cannot travel any further than here.
 */
function readKind(value: string): FinanceKind | '' {
  return FINANCE_KINDS.find((candidate) => candidate === value) ?? ''
}

function readMethod(value: string): PaymentMethod | '' {
  return PAYMENT_METHODS.find((candidate) => candidate === value) ?? ''
}

function readStatus(value: string): FinanceStatus | '' {
  return FINANCE_STATUSES.find((candidate) => candidate === value) ?? ''
}

function readSort(value: string): FinanceSort {
  return FINANCE_SORTS.find((candidate) => candidate === value) ?? '-occurredAt'
}

/**
 * An amount filter is only sent once it is a decimal the server will accept. A half-typed "1200."
 * would otherwise be refused as the reader typed it, which reads as the screen breaking rather
 * than as a value still being entered.
 */
function readAmountFilter(value: string): string {
  const trimmed = value.trim()
  return trimmed === '' || AMOUNT_FILTER.test(trimmed) ? trimmed : ''
}
