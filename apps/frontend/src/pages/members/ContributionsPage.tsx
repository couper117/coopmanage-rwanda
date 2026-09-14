import { Coins, SearchX, SlidersHorizontal, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
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
  type BadgeTone,
  type Column,
  type SelectOption,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import {
  CONTRIBUTION_STATUSES,
  CONTRIBUTION_TYPES,
  countActiveContributionFilters,
  type ContributionRow,
} from '@/features/members/members.api'
import {
  useContributionFilters,
  useContributionsList,
  useFormatDate,
  useFormatNumber,
  useMemberError,
  useVoidContribution,
} from '@/features/members/members.hooks'

/**
 * Every contribution the cooperative has taken in, across all members.
 *
 * The member profile answers "what has this person paid". This screen answers the questions a
 * treasurer is asked at a meeting: what came in this month, how much of it was savings, and
 * whether a particular receipt was ever recorded. The total in the footer is therefore the total
 * of the whole filtered set rather than of the rows on screen.
 *
 * Nothing on this screen deletes anything. A contribution recorded in error is cancelled, which
 * writes a reversal into the ledger and leaves both entries visible, so a figure never silently
 * changes between one month's report and the next.
 */

const STATUS_TONE: Readonly<Record<string, BadgeTone>> = {
  POSTED: 'success',
  VOID: 'neutral',
}

export function ContributionsPage() {
  const { t } = useTranslation(['members', 'common'])
  const navigate = useNavigate()
  const describeError = useMemberError()
  const formatDate = useFormatDate()
  const formatNumber = useFormatNumber()

  const { filters, setFilter, clearFilters, goToPage } = useContributionFilters()
  const list = useContributionsList(filters)
  const voidContribution = useVoidContribution()

  const canVoid = usePermission('contributions:void')
  const [showFilters, setShowFilters] = useState(() => countActiveContributionFilters(filters) > 0)
  const [voiding, setVoiding] = useState<ContributionRow | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const rows = list.data?.items ?? []
  const meta = list.data?.meta
  const activeFilters = countActiveContributionFilters(filters)
  const filtersApplied = activeFilters > 0

  const typeOptions: SelectOption[] = [
    { value: '', label: t('members:ledger.anyType') },
    ...CONTRIBUTION_TYPES.map((value) => ({
      value,
      label: t(`members:contributions.type.${value}`),
    })),
  ]

  const statusOptions: SelectOption[] = [
    { value: '', label: t('members:ledger.anyStatus') },
    ...CONTRIBUTION_STATUSES.map((value) => ({
      value,
      label: t(`members:contributions.status.${value}`),
    })),
  ]

  const columns: Column<ContributionRow>[] = [
    {
      key: 'paidOn',
      header: t('members:contributions.columns.paidOn'),
      render: (row) => formatDate(row.paidOn),
    },
    {
      key: 'member',
      header: t('members:ledger.columns.member'),
      render: (row) => (
        <div className="min-w-0">
          <span className="block truncate font-medium text-ink">{row.memberName}</span>
          <span className="block text-sm text-ink-muted">{row.memberCode}</span>
        </div>
      ),
    },
    {
      key: 'type',
      header: t('members:contributions.columns.type'),
      render: (row) => t(`members:contributions.type.${row.type}`, { defaultValue: row.type }),
    },
    {
      key: 'amount',
      header: t('members:contributions.columns.amount'),
      align: 'right',
      render: (row) => <Money value={row.amount} tone={row.status === 'VOID' ? 'neutral' : 'in'} />,
    },
    {
      key: 'method',
      header: t('members:contributions.columns.method'),
      render: (row) => t(`members:method.${row.method}`, { defaultValue: row.method }),
    },
    {
      key: 'reference',
      header: t('members:ledger.columns.reference'),
      render: (row) => (
        <span className="text-sm text-ink-muted">
          {row.financeReference ?? row.reference ?? '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('members:contributions.columns.status'),
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>
          {t(`members:contributions.status.${row.status}`, { defaultValue: row.status })}
        </Badge>
      ),
    },
  ]

  if (canVoid) {
    columns.push({
      key: 'cancel',
      header: t('members:ledger.columns.action'),
      align: 'right',
      render: (row) =>
        row.status === 'POSTED' ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation()
              setNotice(null)
              setReason('')
              setReasonError(null)
              setVoiding(row)
            }}
          >
            {t('members:ledger.cancel')}
          </Button>
        ) : null,
    })
  }

  function submitVoid() {
    if (!voiding) return
    const trimmed = reason.trim()
    if (trimmed.length === 0) {
      // A cancellation without a reason is the entry an auditor asks about first.
      setReasonError(t('members:ledger.reasonRequired'))
      return
    }

    voidContribution.mutate(
      { id: voiding.id, reason: trimmed },
      {
        onSuccess: (result) => {
          setNotice(
            t('members:ledger.cancelled', {
              name: voiding.memberName,
              reference: result.reversalReference ?? '—',
            }),
          )
          setVoiding(null)
          setReason('')
        },
      },
    )
  }

  const from = meta ? (meta.page - 1) * meta.pageSize + 1 : 0
  const to = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('members:ledger.title')} description={t('members:ledger.description')} />

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

      {list.isError ? <Alert tone="danger">{describeError(list.error).message}</Alert> : null}

      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <FormField label={t('members:ledger.filters.from')} className="w-44">
              <Input
                type="date"
                value={filters.from}
                onChange={(event) => setFilter('from', event.target.value)}
              />
            </FormField>
            <FormField label={t('members:ledger.filters.to')} className="w-44">
              <Input
                type="date"
                value={filters.to}
                onChange={(event) => setFilter('to', event.target.value)}
              />
            </FormField>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              leadingIcon={<SlidersHorizontal className="size-4" aria-hidden />}
              onClick={() => setShowFilters((open) => !open)}
              aria-expanded={showFilters}
            >
              {activeFilters > 0
                ? t('members:filters.showWithCount', { count: activeFilters })
                : t('members:filters.show')}
            </Button>
            {filtersApplied ? (
              <Button
                variant="ghost"
                leadingIcon={<X className="size-4" aria-hidden />}
                onClick={clearFilters}
              >
                {t('common:actions.clearFilters')}
              </Button>
            ) : null}
          </div>
        </div>

        {showFilters ? (
          <div className="grid gap-3 border-b border-line px-4 py-3 sm:grid-cols-2">
            <FormField label={t('members:contributions.columns.type')}>
              <Select
                options={typeOptions}
                value={filters.type}
                onChange={(event) => setFilter('type', event.target.value as typeof filters.type)}
              />
            </FormField>
            <FormField label={t('members:contributions.columns.status')}>
              <Select
                options={statusOptions}
                value={filters.status}
                onChange={(event) =>
                  setFilter('status', event.target.value as typeof filters.status)
                }
              />
            </FormField>
          </div>
        ) : null}

        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t('members:ledger.caption')}
          loading={list.isPending}
          rowMuted={(row) => row.status === 'VOID'}
          onRowClick={(row) => void navigate(`/members/${row.memberId}`)}
          empty={
            filtersApplied ? (
              <EmptyState
                icon={SearchX}
                title={t('members:ledger.emptyFilteredTitle')}
                description={t('members:ledger.emptyFilteredBody')}
                action={
                  <Button variant="secondary" onClick={clearFilters}>
                    {t('common:actions.clearFilters')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Coins}
                title={t('members:ledger.emptyTitle')}
                description={t('members:ledger.emptyBody')}
              />
            )
          }
          mobileRow={(row) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">{row.memberName}</span>
                <Money value={row.amount} tone={row.status === 'VOID' ? 'neutral' : 'in'} />
              </div>
              <p className="text-sm text-ink-muted">
                {formatDate(row.paidOn)} ·{' '}
                {t(`members:contributions.type.${row.type}`, { defaultValue: row.type })}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>
                  {t(`members:contributions.status.${row.status}`, { defaultValue: row.status })}
                </Badge>
                <span className="text-sm text-ink-muted">{row.memberCode}</span>
              </div>
            </div>
          )}
        />

        {meta && meta.total > 0 && !list.isPending ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-ink-muted">
                {t('members:pagination.summary', {
                  from: formatNumber(from),
                  to: formatNumber(to),
                  total: formatNumber(meta.total),
                })}
              </p>
              <p className="text-sm text-ink">
                {/* The total of everything the filters cover, not of this page. */}
                {t('members:ledger.filteredTotal')}{' '}
                <Money value={meta.totalAmount} withCurrency tone="in" />
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={meta.page <= 1}
                onClick={() => goToPage(meta.page - 1)}
              >
                {t('common:actions.previous')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={meta.page >= meta.totalPages}
                onClick={() => goToPage(meta.page + 1)}
              >
                {t('common:actions.next')}
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      <Dialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) {
            setVoiding(null)
            setReason('')
            setReasonError(null)
          }
        }}
        title={t('members:ledger.cancelTitle')}
        description={
          voiding
            ? t('members:ledger.cancelDescription', {
                name: voiding.memberName,
                amount: voiding.amount,
              })
            : undefined
        }
        busy={voidContribution.isPending}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setVoiding(null)}
              disabled={voidContribution.isPending}
            >
              {/* Not the shared "Cancel", which here would sit next to "Cancel the contribution"
                  and mean the opposite of it. */}
              {t('members:ledger.keep')}
            </Button>
            <Button variant="danger" onClick={submitVoid} loading={voidContribution.isPending}>
              {t('members:ledger.cancelConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">{t('members:ledger.cancelConsequence')}</p>
          <FormField
            label={t('members:ledger.reason')}
            hint={t('members:ledger.reasonHint')}
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
          {voidContribution.isError ? (
            <Alert tone="danger">{describeError(voidContribution.error).message}</Alert>
          ) : null}
        </div>
      </Dialog>
    </div>
  )
}
