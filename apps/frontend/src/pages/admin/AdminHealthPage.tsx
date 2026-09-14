import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { Alert, Badge, Button, Panel, Skeleton } from '@/components/ui'
import { fetchPlatformHealth } from '@/features/admin/admin.api'
import {
  adminKeys,
  useAdminError,
  useFormatDateTime,
  useFormatNumber,
} from '@/features/admin/admin.hooks'

/**
 * Is the platform answering, and how much is it carrying.
 *
 * Deliberately read on demand rather than polled: an operator opens this screen when they are
 * already worried about something, and a figure that moves on its own while they are reading it
 * makes the screen harder to trust rather than easier.
 */
export function AdminHealthPage() {
  const { t } = useTranslation(['admin', 'common'])
  const describeError = useAdminError()
  const formatDateTime = useFormatDateTime()
  const formatNumber = useFormatNumber()

  const health = useQuery({
    queryKey: adminKeys.health,
    queryFn: fetchPlatformHealth,
    staleTime: 0,
  })

  const data = health.data
  const latency = data?.database.latencyMs ?? null

  return (
    <>
      <PageHeader
        title={t('admin:health.title')}
        description={t('admin:health.description')}
        actions={
          <Button
            variant="secondary"
            loading={health.isFetching}
            onClick={() => void health.refetch()}
          >
            {t('admin:health.refresh')}
          </Button>
        }
      />

      {health.isError ? (
        <Alert
          tone="danger"
          title={t('admin:health.error.body')}
          action={
            <Button variant="secondary" size="sm" onClick={() => void health.refetch()}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {describeError(health.error).message}
        </Alert>
      ) : null}

      <Panel title={t('admin:health.database.title')}>
        {health.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : data ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={data.database.reachable ? 'success' : 'danger'}>
                {t(
                  data.database.reachable
                    ? 'admin:health.database.badgeOk'
                    : 'admin:health.database.badgeDown',
                )}
              </Badge>
              <p className="text-base text-ink">
                {data.database.reachable
                  ? latency === null
                    ? t('admin:health.database.reachableNoLatency')
                    : t('admin:health.database.reachable', { latency: formatNumber(latency) })
                  : t('admin:health.database.unreachable')}
              </p>
            </div>
            <p className="text-xs text-ink-muted">
              {t('admin:health.checkedAt', { when: formatDateTime(data.timestamp) })}
            </p>
          </div>
        ) : null}
      </Panel>

      <Panel title={t('admin:health.counts.title')}>
        {health.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-20 w-full" />
            ))}
          </div>
        ) : data ? (
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatTile
              label={t('admin:health.counts.cooperatives')}
              value={formatNumber(data.counts.cooperatives)}
            />
            <StatTile
              label={t('admin:health.counts.activeCooperatives')}
              value={formatNumber(data.counts.activeCooperatives)}
            />
            <StatTile
              label={t('admin:health.counts.users')}
              value={formatNumber(data.counts.users)}
            />
            <StatTile
              label={t('admin:health.counts.activeUsers')}
              value={formatNumber(data.counts.activeUsers)}
            />
            <StatTile
              label={t('admin:health.counts.platformAdmins')}
              value={formatNumber(data.counts.platformAdmins)}
            />
          </dl>
        ) : null}
      </Panel>
    </>
  )
}

/** Label above, figure below, no icon in a coloured circle. `docs/ui-system.md` section 6. */
function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-subtle px-4 py-3">
      <dt className="text-xs font-semibold tracking-wider text-ink-secondary uppercase">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  )
}
