import type { ReportType } from '@coopmanage/shared'
import { Download, History } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Panel,
  type BadgeTone,
  type Column,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import type { ReportRunRow } from './reports.api'
import { useDownloadRun, useReportRuns, useReportsError } from './reports.hooks'

/**
 * What has been produced before.
 *
 * A cooperative asks for the September figures, files the sheet, and three weeks later needs it
 * again. Rather than making them remember which dates they chose, every export is recorded and
 * can be produced again from this list.
 *
 * A run that failed is shown with its reason rather than hidden. A cooperative whose report did
 * not come out needs something to ask about, and "nothing happened" is not it.
 */

const STATUS_TONE: Readonly<Record<string, BadgeTone>> = {
  READY: 'success',
  PENDING: 'warning',
  FAILED: 'danger',
}

export function ReportRunsPanel() {
  const { t } = useTranslation(['reports', 'common'])
  const describeError = useReportsError()
  const canExport = usePermission('reports:export')

  const [page, setPage] = useState(1)
  const [type] = useState<ReportType | ''>('')
  const runs = useReportRuns(page, type)
  const download = useDownloadRun()

  const rows = runs.data?.items ?? []
  const meta = runs.data?.meta

  const columns: Column<ReportRunRow>[] = [
    {
      key: 'title',
      header: t('reports:runs.columns.report'),
      render: (run) => (
        <div>
          <span className="font-medium text-ink">{run.title}</span>
          {run.from && run.to ? (
            <span className="block text-sm text-ink-muted">{`${run.from} → ${run.to}`}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'format',
      header: t('reports:runs.columns.format'),
      render: (run) => <span className="text-sm text-ink-muted">{run.format}</span>,
    },
    {
      key: 'status',
      header: t('reports:runs.columns.status'),
      render: (run) => (
        <div>
          <Badge tone={STATUS_TONE[run.status] ?? 'neutral'}>
            {t(`reports:runs.status.${run.status}`, { defaultValue: run.status })}
          </Badge>
          {/* The reason, in place. A failed run with nothing to read is a support call. */}
          {run.status === 'FAILED' && run.errorMessage ? (
            <span className="mt-0.5 block text-xs text-ink-muted">{run.errorMessage}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'rowCount',
      header: t('reports:runs.columns.rows'),
      align: 'right',
      secondary: true,
      render: (run) => (
        <span className="tabular-nums">{run.rowCount === null ? '—' : run.rowCount}</span>
      ),
    },
    {
      key: 'generatedBy',
      header: t('reports:runs.columns.who'),
      secondary: true,
      render: (run) => <span className="text-sm">{run.generatedBy ?? '—'}</span>,
    },
    {
      key: 'actions',
      header: t('reports:runs.columns.again'),
      align: 'right',
      width: '10rem',
      render: (run) =>
        canExport && run.downloadable ? (
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Download aria-hidden="true" className="size-4" />}
            onClick={() => download.mutate(run)}
            disabled={download.isPending}
          >
            {t('reports:runs.download')}
          </Button>
        ) : null,
    },
  ]

  return (
    <Panel flush title={t('reports:runs.title')} description={t('reports:runs.description')}>
      {download.isError ? (
        <div className="px-4 pt-4">
          <Alert tone="danger">{describeError(download.error).message}</Alert>
        </div>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(run) => run.id}
        caption={t('reports:runs.caption')}
        loading={runs.isPending}
        rowMuted={(run) => run.status === 'FAILED'}
        empty={
          <EmptyState
            icon={History}
            title={t('reports:runs.emptyTitle')}
            description={t('reports:runs.emptyBody')}
          />
        }
        mobileRow={(run) => (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-ink">{run.title}</span>
              <Badge tone={STATUS_TONE[run.status] ?? 'neutral'}>
                {t(`reports:runs.status.${run.status}`, { defaultValue: run.status })}
              </Badge>
            </div>
            {run.from && run.to ? (
              <span className="text-sm text-ink-muted">{`${run.from} → ${run.to}`}</span>
            ) : null}
            {canExport && run.downloadable ? (
              <Button variant="secondary" size="sm" onClick={() => download.mutate(run)}>
                {t('reports:runs.download')}
              </Button>
            ) : null}
          </div>
        )}
      />

      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
          <p className="text-sm text-ink-muted">
            {t('reports:runs.page', { page: meta.page, total: meta.totalPages })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={meta.page <= 1}
            >
              {t('common:actions.previous')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((current) => current + 1)}
              disabled={meta.page >= meta.totalPages}
            >
              {t('common:actions.next')}
            </Button>
          </div>
        </div>
      ) : null}
    </Panel>
  )
}
