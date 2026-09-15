import { CalendarDays, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
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
  type BadgeTone,
  type Column,
  type SelectOption,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { MeetingDialog } from '@/features/meetings/MeetingDialog'
import {
  EMPTY_MEETING_FILTERS,
  MEETING_STATUSES,
  MEETING_TYPES,
  countActiveMeetingFilters,
  type MeetingRow,
  type MeetingStatus,
  type MeetingType,
} from '@/features/meetings/meetings.api'
import {
  useFormatMeetingTime,
  useMeetingsError,
  useMeetingsList,
} from '@/features/meetings/meetings.hooks'
import { useDebouncedValue } from '@/features/finance/finance.hooks'

/**
 * The cooperative's meetings.
 *
 * The list leads with the number and the date, because that is how a minute book is referenced —
 * "the seventh meeting of 2026" — and carries the present count against the quorum, because whether
 * an assembly could decide anything is the first thing anybody asks of a past meeting.
 *
 * Newest first by default. A secretary opening this screen is far more often writing up the meeting
 * that just happened than looking ahead to the next one.
 */

const STATUS_TONE: Readonly<Record<MeetingStatus, BadgeTone>> = {
  SCHEDULED: 'info',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
}

export function MeetingsPage() {
  const { t } = useTranslation(['meetings', 'common'])
  const navigate = useNavigate()
  const describeError = useMeetingsError()
  const formatTime = useFormatMeetingTime()

  const canManage = usePermission('meetings:manage')

  const [filters, setFilters] = useState(EMPTY_MEETING_FILTERS)
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search)
  const meetings = useMeetingsList({ ...filters, q: debounced })

  const [scheduling, setScheduling] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const rows = meetings.data?.items ?? []
  const meta = meetings.data?.meta
  const activeFilters = countActiveMeetingFilters({ ...filters, q: debounced })

  const typeOptions: SelectOption[] = [
    { value: '', label: t('meetings:list.filters.allTypes') },
    ...MEETING_TYPES.map((value) => ({ value, label: t(`meetings:type.${value}`) })),
  ]
  const statusOptions: SelectOption[] = [
    { value: '', label: t('meetings:list.filters.allStatuses') },
    ...MEETING_STATUSES.map((value) => ({ value, label: t(`meetings:status.${value}`) })),
  ]

  const columns: Column<MeetingRow>[] = [
    {
      key: 'reference',
      header: t('meetings:list.columns.reference'),
      render: (row) => <span className="text-sm text-ink-muted">{row.reference}</span>,
    },
    {
      key: 'title',
      header: t('meetings:list.columns.title'),
      render: (row) => (
        <div>
          <span className="font-medium text-ink">{row.title}</span>
          {row.location ? (
            <span className="block text-sm text-ink-muted">{row.location}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'when',
      header: t('meetings:list.columns.when'),
      render: (row) => formatTime(row.scheduledFor),
    },
    {
      key: 'type',
      header: t('meetings:list.columns.type'),
      secondary: true,
      render: (row) => <span className="text-sm">{t(`meetings:type.${row.type}`)}</span>,
    },
    {
      key: 'status',
      header: t('meetings:list.columns.status'),
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status]}>{t(`meetings:status.${row.status}`)}</Badge>
      ),
    },
    {
      key: 'present',
      header: t('meetings:list.columns.present'),
      align: 'right',
      render: (row) => (
        <div className="flex flex-col items-end">
          <span className="tabular-nums">{row.presentCount}</span>
          {/*
            Null quorum shows nothing rather than a tick or a cross: "not required" is not the same
            answer as "not met", and a cross beside a committee meeting whose rules set no quorum
            would tell a cooperative its meeting was invalid.
          */}
          {row.quorumMet === true ? (
            <Badge tone="success">{t('meetings:detail.quorumMet')}</Badge>
          ) : row.quorumMet === false ? (
            <Badge tone="danger">{t('meetings:detail.quorumNotMet')}</Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'decisions',
      header: t('meetings:list.columns.decisions'),
      align: 'right',
      secondary: true,
      render: (row) => <span className="tabular-nums">{row.decisionCount}</span>,
    },
  ]

  const from = meta ? (meta.page - 1) * meta.pageSize + 1 : 0
  const to = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('meetings:title')}
        description={t('meetings:description')}
        actions={
          canManage ? (
            <Button
              leadingIcon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => setScheduling(true)}
            >
              {t('meetings:actions.schedule')}
            </Button>
          ) : null
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

      <Panel title={t('meetings:list.filters.search')}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <FormField label={t('meetings:list.filters.search')}>
            <Input
              value={search}
              placeholder={t('meetings:list.filters.searchPlaceholder')}
              onChange={(event) => {
                setSearch(event.target.value)
                setFilters((current) => ({ ...current, page: 1 }))
              }}
            />
          </FormField>
          <FormField label={t('meetings:list.filters.type')}>
            <Select
              value={filters.type}
              options={typeOptions}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  type: event.target.value as MeetingType | '',
                  page: 1,
                }))
              }
            />
          </FormField>
          <FormField label={t('meetings:list.filters.status')}>
            <Select
              value={filters.status}
              options={statusOptions}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value as MeetingStatus | '',
                  page: 1,
                }))
              }
            />
          </FormField>
          <FormField label={t('meetings:list.filters.from')}>
            <Input
              type="date"
              value={filters.from}
              onChange={(event) =>
                setFilters((current) => ({ ...current, from: event.target.value, page: 1 }))
              }
            />
          </FormField>
          <FormField label={t('meetings:list.filters.to')}>
            <Input
              type="date"
              value={filters.to}
              onChange={(event) =>
                setFilters((current) => ({ ...current, to: event.target.value, page: 1 }))
              }
            />
          </FormField>
        </div>

        {activeFilters > 0 ? (
          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setFilters(EMPTY_MEETING_FILTERS)
                setSearch('')
              }}
            >
              {t('meetings:list.filters.clear')}
            </Button>
          </div>
        ) : null}
      </Panel>

      <Panel flush>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          caption={t('meetings:list.caption')}
          loading={meetings.isPending}
          rowMuted={(row) => row.status === 'CANCELLED'}
          onRowClick={(row) => void navigate(`/meetings/${row.id}`)}
          empty={
            <EmptyState
              icon={CalendarDays}
              title={t('meetings:list.emptyTitle')}
              description={t('meetings:list.emptyBody')}
            />
          }
          mobileRow={(row) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">{row.title}</span>
                <Badge tone={STATUS_TONE[row.status]}>{t(`meetings:status.${row.status}`)}</Badge>
              </div>
              <span className="text-sm text-ink-muted">{row.reference}</span>
              <span className="text-sm text-ink-muted">{formatTime(row.scheduledFor)}</span>
            </div>
          )}
        />

        {meta && meta.total > 0 && !meetings.isPending ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
            <p className="text-sm text-ink-muted">
              {t('meetings:pagination.summary', { from, to, total: meta.total })}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setFilters((current) => ({ ...current, page: Math.max(1, current.page - 1) }))
                }
                disabled={meta.page <= 1}
              >
                {t('common:actions.previous')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
                disabled={meta.page >= meta.totalPages}
              >
                {t('common:actions.next')}
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      {meetings.isError ? (
        <Alert tone="danger">{describeError(meetings.error).message}</Alert>
      ) : null}

      {scheduling ? (
        <MeetingDialog open onOpenChange={setScheduling} meeting={null} onDone={setNotice} />
      ) : null}
    </div>
  )
}
