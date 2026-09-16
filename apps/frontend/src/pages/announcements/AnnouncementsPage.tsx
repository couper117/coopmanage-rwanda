import { Archive, Megaphone, Pencil, Send } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
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
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { AnnouncementDialog } from '@/features/announcements/AnnouncementDialog'
import { ArchiveAnnouncementDialog } from '@/features/announcements/ArchiveAnnouncementDialog'
import { PublishAnnouncementDialog } from '@/features/announcements/PublishAnnouncementDialog'
import {
  ANNOUNCEMENT_STATUSES,
  type AnnouncementFilters,
  type AnnouncementRow,
  type AnnouncementStatus,
} from '@/features/announcements/announcements.api'
import {
  useAnnouncementError,
  useAnnouncements,
  useSmsProvider,
} from '@/features/announcements/announcements.hooks'
import { useDebouncedValue } from '@/features/finance/finance.hooks'

/**
 * What the cooperative has told people, and what it is about to.
 *
 * The list is the history as well as the working set: drafts, published notices and withdrawn ones
 * together, newest first, because "what did we tell the members in August?" is asked as often as
 * "what are we sending today?".
 *
 * A published announcement offers no edit. That is not a permission being hidden — the server
 * refuses either way — but the screen should not offer an action that will fail, and the reason is
 * worth the reader knowing: once it has gone to five hundred telephones, the record has to say
 * what was sent.
 */

const STATUS_TONE: Readonly<Record<AnnouncementStatus, BadgeTone>> = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  ARCHIVED: 'warning',
}

export function AnnouncementsPage() {
  const { t } = useTranslation(['announcements', 'common'])
  const describeError = useAnnouncementError()
  const canManage = usePermission('announcements:manage')
  const canSend = usePermission('sms:send')
  const provider = useSmsProvider()

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<AnnouncementFilters>({ page: 1, pageSize: 25 })
  const debounced = useDebouncedValue(search.trim(), 300)

  const list = useAnnouncements({ ...filters, q: debounced.length >= 2 ? debounced : undefined })
  const rows = list.data?.items ?? []
  const total = list.data?.meta?.total ?? 0

  const [writing, setWriting] = useState<{ row: AnnouncementRow | null } | null>(null)
  const [publishing, setPublishing] = useState<AnnouncementRow | null>(null)
  const [archiving, setArchiving] = useState<AnnouncementRow | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const columns: Column<AnnouncementRow>[] = [
    {
      key: 'title',
      header: t('announcements:columns.title'),
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.title}</p>
          {row.titleRw ? <p className="truncate text-xs text-ink-muted">{row.titleRw}</p> : null}
        </div>
      ),
    },
    {
      key: 'audience',
      header: t('announcements:columns.audience'),
      render: (row) => (
        <span className="text-sm">{t(`announcements:audience.${row.audience}`)}</span>
      ),
    },
    {
      key: 'status',
      header: t('announcements:columns.status'),
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status]}>{t(`announcements:status.${row.status}`)}</Badge>
      ),
    },
    {
      key: 'messages',
      header: t('announcements:columns.messages'),
      align: 'right',
      secondary: true,
      render: (row) =>
        row.messageCount === 0 ? (
          <span className="text-sm text-ink-muted">—</span>
        ) : (
          <Link
            to={`/announcements/messages?announcementId=${row.id}`}
            className="text-sm text-primary-600 tabular-nums hover:underline"
          >
            {row.messageCount}
          </Link>
        ),
    },
    {
      key: 'actions',
      header: t('announcements:columns.actions'),
      align: 'right',
      width: '16rem',
      render: (row) => (
        <div className="flex flex-wrap justify-end gap-1">
          {canManage && row.status === 'DRAFT' ? (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Pencil aria-hidden="true" className="size-4" />}
              onClick={() => setWriting({ row })}
            >
              {t('common:actions.edit')}
            </Button>
          ) : null}
          {canManage && row.status !== 'ARCHIVED' ? (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Send aria-hidden="true" className="size-4" />}
              onClick={() => setPublishing(row)}
            >
              {row.status === 'DRAFT'
                ? t('announcements:actions.publish')
                : t('announcements:actions.send')}
            </Button>
          ) : null}
          {canManage && row.status !== 'ARCHIVED' ? (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Archive aria-hidden="true" className="size-4" />}
              onClick={() => setArchiving(row)}
            >
              {t('announcements:actions.archive')}
            </Button>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('announcements:title')}
        description={t('announcements:description')}
        actions={
          <>
            {canSend ? (
              <Button variant="secondary" asChild>
                <Link to="/announcements/messages">{t('announcements:actions.messages')}</Link>
              </Button>
            ) : null}
            {canManage ? (
              <Button onClick={() => setWriting({ row: null })}>
                {t('announcements:actions.add')}
              </Button>
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

      {/*
        Said once, at the top, rather than only inside the publish dialog: a cooperative looking at
        this list should know whether anything it sends today will actually arrive.
      */}
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
          <FormField label={t('announcements:filters.search')}>
            <Input
              value={search}
              placeholder={t('announcements:filters.searchPlaceholder')}
              onChange={(event) => {
                setSearch(event.target.value)
                setFilters((current) => ({ ...current, page: 1 }))
              }}
            />
          </FormField>
          <FormField label={t('announcements:filters.status')}>
            <Select
              value={filters.status ?? ''}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  page: 1,
                  status: (event.target.value || undefined) as AnnouncementStatus | undefined,
                }))
              }
              options={[
                { value: '', label: t('announcements:filters.anyStatus') },
                ...ANNOUNCEMENT_STATUSES.map((status) => ({
                  value: status,
                  label: t(`announcements:status.${status}`),
                })),
              ]}
            />
          </FormField>
        </div>
      </Panel>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        loading={list.isPending}
        caption={t('announcements:tableCaption')}
        rowMuted={(row) => row.status === 'ARCHIVED'}
        mobileRow={(row) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium text-ink">{row.title}</span>
            <span className="flex items-center gap-2 text-xs text-ink-muted">
              <Badge tone={STATUS_TONE[row.status]}>
                {t(`announcements:status.${row.status}`)}
              </Badge>
              {t(`announcements:audience.${row.audience}`)}
            </span>
          </div>
        )}
        empty={
          <EmptyState
            icon={Megaphone}
            title={t('announcements:empty.title')}
            description={t('announcements:empty.body')}
            headingLevel={3}
            action={
              canManage ? (
                <Button onClick={() => setWriting({ row: null })}>
                  {t('announcements:actions.add')}
                </Button>
              ) : undefined
            }
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

      {writing ? (
        <AnnouncementDialog
          announcement={writing.row}
          onOpenChange={(open) => {
            if (!open) setWriting(null)
          }}
          onDone={setNotice}
        />
      ) : null}

      {publishing ? (
        <PublishAnnouncementDialog
          announcement={publishing}
          onOpenChange={(open) => {
            if (!open) setPublishing(null)
          }}
          onDone={setNotice}
        />
      ) : null}

      {archiving ? (
        <ArchiveAnnouncementDialog
          announcement={archiving}
          onOpenChange={(open) => {
            if (!open) setArchiving(null)
          }}
          onDone={setNotice}
        />
      ) : null}
    </div>
  )
}
