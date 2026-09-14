import { Download, SearchX, SlidersHorizontal, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { formatRwandanPhone } from '@coopmanage/shared'
import { PageHeader } from '@/components/PageHeader'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  FormField,
  Input,
  Panel,
  Select,
  Skeleton,
  type BadgeTone,
  type Column,
  type SelectOption,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { MemberFormDialog } from '@/features/members/MemberFormDialog'
import {
  MEMBER_GENDERS,
  MEMBER_POSITIONS,
  MEMBER_SORTS,
  MEMBER_STATUSES,
  countActiveFilters,
  type MemberFilters,
  type MemberGender,
  type MemberListRow,
  type MemberPosition,
  type MemberSort,
  type MemberStatus,
} from '@/features/members/members.api'
import {
  useDebouncedValue,
  useExportMembers,
  useFormatDate,
  useFormatNumber,
  useMemberError,
  useMemberFilters,
  useMemberStats,
  useMembersList,
} from '@/features/members/members.hooks'

/**
 * The member register.
 *
 * This is the screen a cooperative secretary spends the most time on, so it is built as a proper
 * working list rather than a read-only report: the filters live in the URL so a view can be
 * bookmarked and sent to a colleague, the ordering is explicit, and the whole filtered set can be
 * taken away as a file.
 *
 * There is no delete control anywhere on it. A member is deactivated, suspended or marked as
 * having left, from their own profile, and the record always stays: a deleted member would take
 * their contribution history with them and the cooperative's books have to stay defensible.
 */

const STATUS_TONE: Readonly<Record<MemberStatus, BadgeTone>> = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  SUSPENDED: 'warning',
  EXITED: 'neutral',
}

function statusTone(status: string): BadgeTone {
  return MEMBER_STATUSES.some((value) => value === status)
    ? STATUS_TONE[status as MemberStatus]
    : 'neutral'
}

/**
 * Which way a sortable column currently runs.
 *
 * `DataTable` takes each header as a string, so the marker is part of the header text rather than
 * a button inside the cell; the ordering itself is changed from the labelled control in the
 * toolbar, which is reachable by keyboard and reads correctly to a screen reader.
 */
function sortMarker(sort: MemberSort, column: 'lastName' | 'memberCode' | 'joinedOn'): string {
  if (sort === column) return ' ↑'
  if (sort === `-${column}`) return ' ↓'
  return ''
}

export function MembersPage() {
  const { t } = useTranslation(['members', 'common'])
  const navigate = useNavigate()
  const describeError = useMemberError()
  const formatDate = useFormatDate()
  const formatNumber = useFormatNumber()

  const canCreate = usePermission('members:create')
  const canExport = usePermission('members:export')

  const { filters, patch, clear } = useMemberFilters()
  const list = useMembersList(filters)
  const exportMembers = useExportMembers()

  const [showFilters, setShowFilters] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // The field keeps its own value so typing stays instant; the URL is only rewritten once typing
  // has stopped, which is also what stops one request going out per keystroke.
  const [search, setSearch] = useState(filters.q)
  const debouncedSearch = useDebouncedValue(search, 300)

  useEffect(() => {
    if (debouncedSearch.trim() === filters.q) return
    patch({ q: debouncedSearch.trim() })
  }, [debouncedSearch, filters.q, patch])

  const activeCount = countActiveFilters(filters)
  const filtersApplied = activeCount > 0
  const rows = list.data?.items ?? []
  const meta = list.data?.meta

  function clearEverything(): void {
    setSearch('')
    clear()
  }

  const statusOptions: SelectOption[] = [
    { value: '', label: t('members:filters.anyStatus') },
    ...MEMBER_STATUSES.map((value) => ({ value, label: t(`members:status.${value}`) })),
  ]
  const positionOptions: SelectOption[] = [
    { value: '', label: t('members:filters.anyPosition') },
    ...MEMBER_POSITIONS.map((value) => ({ value, label: t(`members:position.${value}`) })),
  ]
  const genderOptions: SelectOption[] = [
    { value: '', label: t('members:filters.anyGender') },
    ...MEMBER_GENDERS.map((value) => ({ value, label: t(`members:gender.${value}`) })),
  ]
  const phoneOptions: SelectOption[] = [
    { value: '', label: t('members:filters.anyPhone') },
    { value: 'true', label: t('members:filters.hasPhoneYes') },
    { value: 'false', label: t('members:filters.hasPhoneNo') },
  ]
  const sortOptions: SelectOption[] = MEMBER_SORTS.map((value) => ({
    value,
    label: t(`members:sort.${value}`),
  }))

  /** One removable chip per filter in use, so what is narrowing the list is never hidden. */
  const chips = useMemo(() => {
    const entries: { id: keyof MemberFilters; field: string; value: string }[] = []
    if (filters.q)
      entries.push({ id: 'q', field: t('members:filters.searchField'), value: filters.q })
    if (filters.status) {
      entries.push({
        id: 'status',
        field: t('members:filters.status'),
        value: t(`members:status.${filters.status}`),
      })
    }
    if (filters.position) {
      entries.push({
        id: 'position',
        field: t('members:filters.position'),
        value: t(`members:position.${filters.position}`),
      })
    }
    if (filters.gender) {
      entries.push({
        id: 'gender',
        field: t('members:filters.gender'),
        value: t(`members:gender.${filters.gender}`),
      })
    }
    if (filters.district) {
      entries.push({
        id: 'district',
        field: t('members:filters.district'),
        value: filters.district,
      })
    }
    if (filters.sector) {
      entries.push({ id: 'sector', field: t('members:filters.sector'), value: filters.sector })
    }
    if (filters.joinedFrom) {
      entries.push({
        id: 'joinedFrom',
        field: t('members:filters.joinedFrom'),
        value: formatDate(filters.joinedFrom),
      })
    }
    if (filters.joinedTo) {
      entries.push({
        id: 'joinedTo',
        field: t('members:filters.joinedTo'),
        value: formatDate(filters.joinedTo),
      })
    }
    if (filters.hasPhone) {
      entries.push({
        id: 'hasPhone',
        field: t('members:filters.hasPhone'),
        value: t(
          filters.hasPhone === 'true'
            ? 'members:filters.hasPhoneYes'
            : 'members:filters.hasPhoneNo',
        ),
      })
    }
    return entries
  }, [filters, formatDate, t])

  function removeChip(id: keyof MemberFilters): void {
    if (id === 'q') setSearch('')
    patch({ [id]: '' })
  }

  const columns: Column<MemberListRow>[] = [
    {
      key: 'name',
      header: `${t('members:columns.name')}${sortMarker(filters.sort, 'lastName')}`,
      render: (row) => (
        <div className="flex flex-col gap-0.5 py-1">
          <span className="font-medium text-ink">{row.fullName}</span>
          <span className="text-xs text-ink-muted">{row.memberCode}</span>
        </div>
      ),
    },
    {
      key: 'phone',
      header: t('members:columns.phone'),
      render: (row) =>
        row.phone ? (
          formatRwandanPhone(row.phone)
        ) : (
          <span className="text-ink-muted">{t('members:noPhone')}</span>
        ),
    },
    {
      key: 'location',
      header: t('members:columns.location'),
      secondary: true,
      render: (row) =>
        [row.sector, row.district].filter(Boolean).join(', ') || t('members:noLocation'),
    },
    {
      key: 'position',
      header: t('members:columns.position'),
      secondary: true,
      render: (row) => t(`members:position.${row.position}`, { defaultValue: row.position }),
    },
    {
      key: 'status',
      header: t('members:columns.status'),
      render: (row) => (
        <Badge tone={statusTone(row.status)}>
          {t(`members:status.${row.status}`, { defaultValue: row.status })}
        </Badge>
      ),
    },
    {
      key: 'joinedOn',
      header: `${t('members:columns.joinedOn')}${sortMarker(filters.sort, 'joinedOn')}`,
      secondary: true,
      render: (row) => formatDate(row.joinedOn),
    },
  ]

  const from = meta ? (meta.page - 1) * meta.pageSize + 1 : 0
  const to = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0

  return (
    <>
      <PageHeader
        title={t('members:title')}
        description={t('members:description')}
        actions={
          <>
            {canExport ? (
              <Button
                variant="secondary"
                leadingIcon={<Download aria-hidden="true" className="size-4" />}
                loading={exportMembers.isPending}
                onClick={() => exportMembers.mutate(filters)}
              >
                {t('members:actions.export')}
              </Button>
            ) : null}
            {canCreate ? (
              <Button
                leadingIcon={<UserPlus aria-hidden="true" className="size-4" />}
                onClick={() => {
                  setNotice(null)
                  setFormOpen(true)
                }}
              >
                {t('members:actions.add')}
              </Button>
            ) : null}
          </>
        }
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {exportMembers.isError ? (
        <Alert tone="danger" title={t('members:export.failed')}>
          {describeError(exportMembers.error).message}
        </Alert>
      ) : null}

      <StatTiles />

      <Panel flush>
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <FormField label={t('members:search.label')} className="min-w-56 flex-1">
              <Input
                type="search"
                placeholder={t('members:search.placeholder')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </FormField>

            <FormField label={t('members:filters.status')} className="w-44">
              <Select
                options={statusOptions}
                value={filters.status}
                onChange={(event) => patch({ status: event.target.value as MemberStatus | '' })}
              />
            </FormField>

            <FormField label={t('members:filters.position')} className="w-44">
              <Select
                options={positionOptions}
                value={filters.position}
                onChange={(event) => patch({ position: event.target.value as MemberPosition | '' })}
              />
            </FormField>

            <FormField label={t('members:sort.label')} className="w-56">
              <Select
                options={sortOptions}
                value={filters.sort}
                onChange={(event) => patch({ sort: event.target.value as MemberSort })}
              />
            </FormField>

            <Button
              variant="secondary"
              aria-expanded={showFilters}
              aria-controls="member-more-filters"
              leadingIcon={<SlidersHorizontal aria-hidden="true" className="size-4" />}
              onClick={() => setShowFilters((open) => !open)}
            >
              {activeCount > 0
                ? t('members:filters.showWithCount', { total: activeCount })
                : t('members:filters.show')}
            </Button>

            {filtersApplied ? (
              <Button variant="ghost" onClick={clearEverything}>
                {t('common:actions.clearFilters')}
              </Button>
            ) : null}
          </div>

          <div
            id="member-more-filters"
            hidden={!showFilters}
            className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            <FormField label={t('members:filters.gender')}>
              <Select
                options={genderOptions}
                value={filters.gender}
                onChange={(event) => patch({ gender: event.target.value as MemberGender | '' })}
              />
            </FormField>
            <FormField label={t('members:filters.district')}>
              <Input
                value={filters.district}
                onChange={(event) => patch({ district: event.target.value })}
              />
            </FormField>
            <FormField label={t('members:filters.sector')}>
              <Input
                value={filters.sector}
                onChange={(event) => patch({ sector: event.target.value })}
              />
            </FormField>
            <FormField label={t('members:filters.joinedFrom')}>
              <Input
                type="date"
                value={filters.joinedFrom}
                onChange={(event) => patch({ joinedFrom: event.target.value })}
              />
            </FormField>
            <FormField label={t('members:filters.joinedTo')}>
              <Input
                type="date"
                value={filters.joinedTo}
                onChange={(event) => patch({ joinedTo: event.target.value })}
              />
            </FormField>
            <FormField label={t('members:filters.hasPhone')}>
              <Select
                options={phoneOptions}
                value={filters.hasPhone}
                onChange={(event) =>
                  patch({ hasPhone: event.target.value as 'true' | 'false' | '' })
                }
              />
            </FormField>
          </div>

          {chips.length > 0 ? (
            <ul aria-label={t('members:filters.activeLabel')} className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <li key={chip.id}>
                  <button
                    type="button"
                    aria-label={t('members:filters.remove', { field: chip.field })}
                    onClick={() => removeChip(chip.id)}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-surface-subtle px-2 py-0.5 text-xs text-ink-secondary hover:bg-surface hover:text-ink"
                  >
                    {t('members:filters.chip', { field: chip.field, value: chip.value })}
                    <X aria-hidden="true" className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {list.isError ? (
          <div className="p-4">
            <Alert
              tone="danger"
              title={t('members:loadFailed')}
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
              caption={t('members:tableCaption')}
              loading={list.isPending}
              rowMuted={(row) => row.status !== 'ACTIVE'}
              onRowClick={(row) => void navigate(`/members/${row.id}`)}
              empty={
                filtersApplied ? (
                  <EmptyState
                    icon={SearchX}
                    title={t('members:emptyFiltered.title')}
                    description={t('members:emptyFiltered.body')}
                    action={
                      <Button variant="secondary" onClick={clearEverything}>
                        {t('common:actions.clearFilters')}
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon={Users}
                    title={t('members:empty.title')}
                    description={t('members:empty.body')}
                    action={
                      canCreate ? (
                        <Button
                          onClick={() => {
                            setNotice(null)
                            setFormOpen(true)
                          }}
                        >
                          {t('members:actions.add')}
                        </Button>
                      ) : undefined
                    }
                  />
                )
              }
              mobileRow={(row) => (
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{row.fullName}</span>
                    <Badge tone={statusTone(row.status)}>
                      {t(`members:status.${row.status}`, { defaultValue: row.status })}
                    </Badge>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {row.memberCode} ·{' '}
                    {row.phone ? formatRwandanPhone(row.phone) : t('members:noPhone')}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {[row.sector, row.district].filter(Boolean).join(', ') ||
                      t('members:noLocation')}
                  </p>
                </div>
              )}
            />

            {meta && meta.total > 0 && !list.isPending ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
                <p className="text-sm text-ink-muted">
                  {t('members:pagination.summary', {
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

      <MemberFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={(saved) =>
          setNotice(t('members:form.created', { name: saved.fullName, code: saved.memberCode }))
        }
      />
    </>
  )
}

/**
 * The four figures above the table.
 *
 * `withoutPhone` is not a data-quality warning. It is how many members cannot be reached by SMS
 * when a meeting is called, and therefore how many people somebody has to go and tell in person,
 * which is why it sits alongside the headline count rather than in a report.
 */
function StatTiles() {
  const { t } = useTranslation('members')
  const formatNumber = useFormatNumber()
  const stats = useMemberStats()

  if (stats.isError) return null

  const data = stats.data

  return (
    <section
      aria-label={t('stats.wholeRegister')}
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      <StatTile label={t('stats.total')} value={data ? formatNumber(data.total) : undefined} />
      <StatTile
        label={t('stats.active')}
        value={data ? formatNumber(data.byStatus.ACTIVE ?? 0) : undefined}
      />
      <StatTile
        label={t('stats.newThisMonth')}
        value={data ? formatNumber(data.newThisMonth) : undefined}
      />
      <StatTile
        label={t('stats.withoutPhone')}
        value={data ? formatNumber(data.withoutPhone) : undefined}
        hint={t('stats.withoutPhoneHint')}
      />
    </section>
  )
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  /** Absent while the figure is still being read, which shows a shape rather than a zero. */
  value: string | undefined
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-sm text-ink-secondary">{label}</p>
      {value === undefined ? (
        <Skeleton className="mt-1 h-7 w-16" />
      ) : (
        <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      )}
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  )
}
