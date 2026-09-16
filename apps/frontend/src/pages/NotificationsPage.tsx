import { BellOff, Filter } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { Alert, Button, EmptyState, FormField, Panel, Select, Skeleton } from '@/components/ui'
import { NotificationLine } from '@/features/notifications/NotificationBell'
import {
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_TYPES,
  type NotificationFilters,
  type NotificationSeverity,
  type NotificationType,
} from '@/features/notifications/notifications.api'
import {
  useMarkAllNotificationsRead,
  useNotificationError,
  useNotifications,
} from '@/features/notifications/notifications.hooks'

/**
 * The whole list, for when reading the list is the task.
 *
 * The bell answers "what is waiting?" without leaving the screen. This answers the other two
 * questions: "what have we been told lately?" and — the one that matters after something has gone
 * wrong — "were we warned about this?" That second question is why dismissed notifications can be
 * asked for rather than being gone.
 */
export function NotificationsPage() {
  const { t } = useTranslation(['notifications', 'common'])
  const describeError = useNotificationError()
  const markAll = useMarkAllNotificationsRead()

  const [filters, setFilters] = useState<NotificationFilters>({
    page: 1,
    pageSize: 25,
    dismissed: 'exclude',
    unreadOnly: false,
  })

  const list = useNotifications(filters)
  const rows = list.data?.items ?? []
  const total = list.data?.meta?.total ?? 0

  const set = (changes: Partial<NotificationFilters>) =>
    setFilters((current) => ({ ...current, ...changes, page: 1 }))

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('notifications:title')}
        description={t('notifications:description')}
        actions={
          <Button
            variant="secondary"
            size="sm"
            loading={markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            {t('notifications:actions.readAll')}
          </Button>
        }
      />

      <Panel title={t('common:actions.filter')}>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t('notifications:filters.type')}>
            <Select
              value={filters.type ?? ''}
              onChange={(event) =>
                set({ type: (event.target.value || undefined) as NotificationType | undefined })
              }
              options={[
                { value: '', label: t('notifications:filters.anyType') },
                ...NOTIFICATION_TYPES.map((type) => ({
                  value: type,
                  label: t(`notifications:type.${type}`),
                })),
              ]}
            />
          </FormField>
          <FormField label={t('notifications:filters.severity')}>
            <Select
              value={filters.severity ?? ''}
              onChange={(event) =>
                set({
                  severity: (event.target.value || undefined) as NotificationSeverity | undefined,
                })
              }
              options={[
                { value: '', label: t('notifications:filters.anySeverity') },
                ...NOTIFICATION_SEVERITIES.map((severity) => ({
                  value: severity,
                  label: t(`notifications:severity.${severity}`),
                })),
              ]}
            />
          </FormField>
          <FormField label={t('notifications:filters.state')}>
            <Select
              value={
                filters.unreadOnly ? 'unread' : filters.dismissed === 'only' ? 'dismissed' : 'all'
              }
              onChange={(event) => {
                const value = event.target.value
                set({
                  unreadOnly: value === 'unread',
                  // "Were we warned?" is asked of the dismissed ones, so they are a state to choose
                  // rather than rows that have gone.
                  dismissed: value === 'dismissed' ? 'only' : 'exclude',
                })
              }}
              options={[
                { value: 'all', label: t('notifications:filters.stateAll') },
                { value: 'unread', label: t('notifications:filters.stateUnread') },
                { value: 'dismissed', label: t('notifications:filters.stateDismissed') },
              ]}
            />
          </FormField>
        </div>
      </Panel>

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

      <Panel flush>
        {list.isPending ? (
          <div aria-busy="true" className="flex flex-col gap-2 p-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={filters.dismissed === 'only' ? Filter : BellOff}
            title={t('notifications:empty.title')}
            description={t('notifications:empty.body')}
            headingLevel={3}
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <NotificationLine
                key={row.id}
                row={row}
                // A dismissed notification is being read as history; offering to dismiss it again
                // would be a button that does nothing.
                showDismiss={filters.dismissed !== 'only'}
              />
            ))}
          </ul>
        )}
      </Panel>

      {total > filters.pageSize ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">
            {t('notifications:pagination.summary', {
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
