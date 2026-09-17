import { REPORTS, REPORT_TYPES, type ReportFormat, type ReportType } from '@coopmanage/shared'
import { Download, FileText, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { LoadError } from '@/components/LoadError'
import {
  Alert,
  Button,
  FormField,
  Input,
  Panel,
  Select,
  Skeleton,
  type SelectOption,
} from '@/components/ui'
import { usePermission } from '@/features/auth/useSession'
import { ReportRunsPanel } from '@/features/reports/ReportRunsPanel'
import { ReportView } from '@/features/reports/ReportView'
import { currentMonthRange, type ReportParams } from '@/features/reports/reports.api'
import {
  useExportReport,
  useReportCatalogue,
  useReportPreview,
  useReportsError,
} from '@/features/reports/reports.hooks'

/**
 * Reports.
 *
 * The screen is arranged around the one report that matters most and the reason the others exist:
 * the monthly cooperative report, which is what a committee reads out at a general assembly. So it
 * is the report the screen opens on, the period defaults to the month just gone, and the preview
 * is on the page rather than behind a button — because the thing somebody wants to know first is
 * whether the figures look right, not whether the export works.
 *
 * Everything the reader cannot see is said before the paper is produced. A report their role does
 * not cover is listed and disabled with the reason; a report they may produce but only part of is
 * marked with which sections will be missing. Finding out after printing forty copies for a
 * meeting is the failure this avoids.
 */

const FORMATS: readonly ReportFormat[] = ['pdf', 'csv', 'xlsx']

export function ReportsPage() {
  const { t } = useTranslation(['reports', 'common'])
  const describeError = useReportsError()

  const canExport = usePermission('reports:export')
  const catalogue = useReportCatalogue()

  const [type, setType] = useState<ReportType>('monthly-cooperative')
  const [range, setRange] = useState(() => currentMonthRange())
  const [format, setFormat] = useState<ReportFormat>('pdf')
  const [notice, setNotice] = useState<string | null>(null)

  const row = catalogue.data?.find((entry) => entry.type === type)
  // The server's catalogue is authoritative about what it can produce; the shared definition is
  // the fallback while the catalogue is still loading. Reading only the shared constant would mean
  // a screen that disagreed with the server the moment a report's data arrived on one and not the
  // other.
  const definition = REPORTS[type]
  const available = row?.available ?? definition.available
  const availableFromPhase = row?.availableFromPhase ?? definition.availableFromPhase
  const params = useMemo<ReportParams>(() => ({ from: range.from, to: range.to }), [range])

  // A period the wrong way round is a mistake the screen can answer at once, rather than a request
  // the server refuses a moment later.
  const rangeBackwards = range.from > range.to
  const canPreview = Boolean(row?.permitted) && available && !rangeBackwards

  const preview = useReportPreview(type, params, canPreview)
  const exporting = useExportReport()

  const typeOptions: SelectOption[] = REPORT_TYPES.map((value) => {
    const entry = catalogue.data?.find((candidate) => candidate.type === value)
    return {
      value,
      label: entry?.title ?? t(`reports:type.${value}`),
      // A report the reader may not produce stays in the list, disabled: knowing the cooperative
      // has a financial report and that this role does not cover it is more use than a short menu
      // that leaves them wondering.
      disabled: entry ? !entry.permitted : false,
    }
  })

  const formatOptions: SelectOption[] = FORMATS.map((value) => ({
    value,
    label: t(`reports:format.${value}`),
  }))

  function produce() {
    setNotice(null)
    exporting.mutate(
      { type, params, format },
      {
        onSuccess: (file) => setNotice(t('reports:export.done', { filename: file.filename })),
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div data-print="hide">
        <PageHeader
          title={t('reports:title')}
          description={t('reports:description')}
          actions={
            <>
              <Button
                variant="secondary"
                leadingIcon={<Printer aria-hidden="true" className="size-4" />}
                onClick={() => window.print()}
                disabled={!preview.data}
              >
                {t('reports:actions.print')}
              </Button>
              {canExport ? (
                <Button
                  leadingIcon={<Download aria-hidden="true" className="size-4" />}
                  onClick={produce}
                  disabled={!canPreview || exporting.isPending}
                >
                  {exporting.isPending
                    ? t('reports:actions.producing')
                    : t('reports:actions.export')}
                </Button>
              ) : null}
            </>
          }
        />
      </div>

      <Panel
        title={t('reports:chooser.title')}
        description={t('reports:chooser.description')}
        className="print:hidden"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label={t('reports:chooser.report')}>
            <Select
              value={type}
              options={typeOptions}
              onChange={(event) => {
                setNotice(null)
                setType(event.target.value as ReportType)
              }}
            />
          </FormField>
          <FormField label={t('reports:chooser.from')}>
            <Input
              type="date"
              value={range.from}
              onChange={(event) => setRange({ ...range, from: event.target.value })}
            />
          </FormField>
          <FormField label={t('reports:chooser.to')}>
            <Input
              type="date"
              value={range.to}
              onChange={(event) => setRange({ ...range, to: event.target.value })}
            />
          </FormField>
          {canExport ? (
            <FormField label={t('reports:chooser.format')}>
              <Select
                value={format}
                options={formatOptions}
                onChange={(event) => setFormat(event.target.value as ReportFormat)}
              />
            </FormField>
          ) : null}
        </div>
      </Panel>

      {rangeBackwards ? (
        <Alert tone="warning" className="print:hidden">
          {t('reports:chooser.backwards')}
        </Alert>
      ) : null}

      {/* A report whose data has not arrived yet says which phase brings it, rather than being
          hidden from a cooperative that is looking for it. */}
      {available ? null : (
        <Alert tone="info" className="print:hidden">
          {t('reports:notYetAvailable', { phase: availableFromPhase })}
        </Alert>
      )}

      {row && !row.permitted ? (
        <Alert tone="warning" className="print:hidden">
          {t('reports:notPermitted')}
        </Alert>
      ) : null}

      {row && row.permitted && row.withheld.length > 0 ? (
        <Alert tone="info" className="print:hidden">
          {t('reports:withheldWarning', { sections: row.withheld.join(', ') })}
        </Alert>
      ) : null}

      {notice ? (
        <Alert
          tone="success"
          className="print:hidden"
          action={
            <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
              {t('common:actions.close')}
            </Button>
          }
        >
          {notice}
        </Alert>
      ) : null}

      {exporting.isError ? (
        <Alert tone="danger" className="print:hidden">
          {describeError(exporting.error).message}
        </Alert>
      ) : null}

      {catalogue.isPending ? <Skeleton className="h-40 w-full" /> : null}

      {canPreview && preview.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {preview.isError ? (
        <div className="print:hidden">
          <LoadError error={preview.error} onRetry={preview.refetch} />
        </div>
      ) : null}

      {preview.data ? <ReportView report={preview.data} /> : null}

      {preview.data && preview.data.rowCount === 0 ? (
        <Alert tone="info" className="print:hidden">
          {t('reports:emptyPeriod')}
        </Alert>
      ) : null}

      <div className="print:hidden">
        <ReportRunsPanel />
      </div>

      {!canPreview && !catalogue.isPending && available && row?.permitted === false ? (
        <Panel className="print:hidden">
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <FileText aria-hidden="true" className="size-4" />
            {t('reports:notPermitted')}
          </p>
        </Panel>
      ) : null}
    </div>
  )
}
