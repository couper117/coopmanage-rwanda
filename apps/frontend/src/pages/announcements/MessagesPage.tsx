import { MessageSquare } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { formatRwandanPhone } from '@coopmanage/shared'
import { PageHeader } from '@/components/PageHeader'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  FormField,
  Panel,
  Select,
  type BadgeTone,
  type Column,
} from '@/components/ui'
import {
  SMS_STATUSES,
  type SmsFilters,
  type SmsLogRow,
  type SmsStatus,
} from '@/features/announcements/announcements.api'
import {
  useAnnouncementError,
  useMessages,
  useSmsProvider,
} from '@/features/announcements/announcements.hooks'

/**
 * Every message the cooperative has sent its members.
 *
 * The log is the product rather than a debugging aid. A committee asked "did we tell the members
 * the assembly had moved?" needs to answer with a list of who was texted, at what number, and
 * which ones failed — a claim nobody can make from a gateway's dashboard they have no account for.
 *
 * The body of each message is here, which is why `sms:send` guards reading as well as sending: a
 * reminder about an unpaid contribution names the member and the amount.
 */

const STATUS_TONE: Readonly<Record<SmsStatus, BadgeTone>> = {
  QUEUED: 'neutral',
  SENT: 'success',
  FAILED: 'danger',
}

export function MessagesPage() {
  const { t, i18n } = useTranslation(['announcements', 'common'])
  const describeError = useAnnouncementError()
  const provider = useSmsProvider()
  const [params] = useSearchParams()

  const [filters, setFilters] = useState<SmsFilters>({
    page: 1,
    pageSize: 25,
    // Arrived from an announcement's message count, so the log opens on that announcement.
    announcementId: params.get('announcementId') ?? undefined,
  })

  const list = useMessages(filters)
  const rows = list.data?.items ?? []
  const total = list.data?.meta?.total ?? 0

  const when = (iso: string | null): string =>
    iso === null
      ? '—'
      : new Intl.DateTimeFormat(i18n.language === 'rw' ? 'rw-RW' : 'en-RW', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(iso))

  const columns: Column<SmsLogRow>[] = [
    {
      key: 'member',
      header: t('announcements:messages.columns.member'),
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-ink">
            {row.memberName ?? t('announcements:messages.noMember')}
          </p>
          <p className="truncate text-xs text-ink-muted">
            {/* The number as it was sent, formatted the way it is read aloud. */}
            {formatRwandanPhone(row.toPhone)}
            {row.memberCode ? ` · ${row.memberCode}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'body',
      header: t('announcements:messages.columns.body'),
      render: (row) => <span className="line-clamp-2 text-sm text-ink-secondary">{row.body}</span>,
    },
    {
      key: 'status',
      header: t('announcements:messages.columns.status'),
      render: (row) => (
        <div className="flex flex-col gap-1">
          <Badge tone={STATUS_TONE[row.status]}>
            {t(`announcements:messages.status.${row.status}`)}
          </Badge>
          {row.failureReason ? (
            <span className="text-xs text-danger-fg">{row.failureReason}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'announcement',
      header: t('announcements:messages.columns.announcement'),
      secondary: true,
      render: (row) =>
        row.announcementTitle ? (
          <span className="text-sm text-ink-secondary">{row.announcementTitle}</span>
        ) : (
          <span className="text-sm text-ink-muted">{t('announcements:messages.adHoc')}</span>
        ),
    },
    {
      key: 'sentAt',
      header: t('announcements:messages.columns.sentAt'),
      align: 'right',
      secondary: true,
      render: (row) => (
        <span className="text-sm whitespace-nowrap text-ink-secondary">
          {when(row.sentAt ?? row.createdAt)}
        </span>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('announcements:messages.title')}
        description={t('announcements:messages.description')}
        actions={
          <Button variant="secondary" asChild>
            <Link to="/announcements">{t('announcements:messages.back')}</Link>
          </Button>
        }
      />

      {provider.data && !provider.data.delivers ? (
        <Alert tone="warning" title={t('announcements:provider.mockTitle')}>
          {t('announcements:provider.mockBody')}
        </Alert>
      ) : null}

      {list.isError ? (
        <Alert
          tone="danger"
          action={
            <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {describeError(list.error).message}
        </Alert>
      ) : null}

      <Panel title={t('common:actions.filter')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('announcements:messages.filters.status')}>
            <Select
              value={filters.status ?? ''}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  page: 1,
                  status: (event.target.value || undefined) as SmsStatus | undefined,
                }))
              }
              options={[
                { value: '', label: t('announcements:messages.filters.anyStatus') },
                ...SMS_STATUSES.map((status) => ({
                  value: status,
                  label: t(`announcements:messages.status.${status}`),
                })),
              ]}
            />
          </FormField>
          {filters.announcementId ? (
            <FormField label={t('announcements:messages.filters.announcement')}>
              <Button
                variant="secondary"
                onClick={() =>
                  setFilters((current) => ({ ...current, page: 1, announcementId: undefined }))
                }
              >
                {t('announcements:messages.filters.clearAnnouncement')}
              </Button>
            </FormField>
          ) : null}
        </div>
      </Panel>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        loading={list.isPending}
        caption={t('announcements:messages.caption')}
        rowMuted={(row) => row.status === 'FAILED'}
        mobileRow={(row) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium text-ink">
              {row.memberName ?? formatRwandanPhone(row.toPhone)}
            </span>
            <span className="line-clamp-2 text-xs text-ink-muted">{row.body}</span>
            <Badge tone={STATUS_TONE[row.status]}>
              {t(`announcements:messages.status.${row.status}`)}
            </Badge>
          </div>
        )}
        empty={
          <EmptyState
            icon={MessageSquare}
            title={t('announcements:messages.empty.title')}
            description={t('announcements:messages.empty.body')}
            headingLevel={3}
          />
        }
      />

      {total > filters.pageSize ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">
            {t('announcements:pagination.summary', {
              from: (filters.page - 1) * filters.pageSize + 1,
              to: Math.min(filters.page * filters.pageSize, total),
              total,
            })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={filters.page === 1}
              onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}
            >
              {t('common:actions.previous')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={filters.page * filters.pageSize >= total}
              onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
            >
              {t('common:actions.next')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
