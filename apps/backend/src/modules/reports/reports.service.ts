import {
  REPORTS,
  REPORT_TYPES,
  reportLabel,
  type Locale,
  type ReportDocument,
  type ReportType,
} from '@coopmanage/shared'
import type { Prisma, ReportFormat as DbReportFormat } from '@prisma/client'
import { writeAudit } from '../../lib/audit.js'
import type { RequestContext } from '../../lib/context.js'
import { AppError } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'
import { prisma } from '../../lib/prisma.js'
import { buildReport } from './reports.data.js'
import type { ExportReportInput, ListReportRunsQuery, ReportParams } from './reports.schemas.js'
import { renderReportCsv } from './render.csv.js'
import { renderReportPdf } from './render.pdf.js'
import { renderReportXlsx } from './render.xlsx.js'

/**
 * Producing a report, and keeping a record that it was produced.
 *
 * Every export writes a `ReportRun` row: what was asked for, by whom, in what format, and whether
 * it worked. Two reasons, and neither is bookkeeping for its own sake. A cooperative asked for the
 * September figures three weeks ago and wants the same sheet again — the parameters are on the row,
 * so it can be produced again and come back with the same numbers. And a report that failed leaves
 * a row saying so, rather than a spinner that stopped and nothing to ask about.
 *
 * There is no file storage in this phase, so a download produces the report again from its stored
 * parameters rather than serving a kept copy. That is a deliberate deviation, recorded in
 * `docs/reports.md`: the figures are recomputed, so a correction posted since the run will show up
 * in the reproduced file. For a cooperative that is the better behaviour — a re-download that
 * still carried a figure since corrected would be the surprise — and when Phase 9 brings file
 * storage, `storageKey` is where the kept copy goes and the original bytes become available as
 * well.
 */

export interface CatalogueRow {
  type: ReportType
  title: string
  /** Whether this reader may produce it at all. */
  permitted: boolean
  permission: string
  available: boolean
  availableFromPhase: number
  /** The sections this reader would not see, named, so the screen can warn before producing it. */
  withheld: string[]
}

/** What a reader may produce, in the order the catalogue lists it. */
export function listReportCatalogue(ctx: RequestContext): CatalogueRow[] {
  if (!ctx.cooperative) throw AppError.noCooperativeAccess()
  const locale = ctx.user.locale

  return REPORT_TYPES.map((type) => {
    const definition = REPORTS[type]
    const withheld = Object.entries(definition.sectionPermissions)
      .filter(([, permission]) => permission && !ctx.permissions.has(permission))
      .map(([section]) => reportLabel(locale, `section.${section}`))

    return {
      type,
      title: reportLabel(locale, `report.${type}`),
      permitted: ctx.permissions.has(definition.permission),
      permission: definition.permission,
      available: definition.available,
      availableFromPhase: definition.availableFromPhase,
      withheld,
    }
  })
}

/** The report as data, for the screen. */
export async function previewReport(
  ctx: RequestContext,
  type: ReportType,
  params: ReportParams,
): Promise<ReportDocument> {
  requireAvailable(ctx, type)
  return buildReport(ctx, type, params)
}

function requireAvailable(ctx: RequestContext, type: ReportType): void {
  const definition = REPORTS[type]
  if (definition.available) return
  // Refused with the phase that brings it rather than with a bare "not found": a cooperative
  // expecting a minutes report should be told when it arrives.
  throw AppError.conflict(
    'errors.reports.notYetAvailable',
    `the ${type} report needs data that arrives in phase ${definition.availableFromPhase}`,
  )
}

export interface ProducedReport {
  filename: string
  contentType: string
  body: Buffer | string
  runId: string
  rowCount: number
}

const CONTENT_TYPES: Readonly<Record<'pdf' | 'csv' | 'xlsx', string>> = {
  pdf: 'application/pdf',
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

const DB_FORMATS: Readonly<Record<'pdf' | 'csv' | 'xlsx', DbReportFormat>> = {
  pdf: 'PDF',
  csv: 'CSV',
  xlsx: 'XLSX',
}

/**
 * A filename a cooperative can find again a year later.
 *
 * The cooperative's code, the report and the period it covers, in that order, because a folder of
 * these sorts into something legible. Never the report's translated title: a Kinyarwanda title
 * would put an apostrophe into a filename, which some of the machines these files are copied onto
 * handle badly.
 */
function filenameFor(code: string, type: ReportType, params: ReportParams, format: string): string {
  const safeCode = code.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  return `${safeCode}-${type}-${params.from}-to-${params.to}.${format}`
}

async function render(
  report: ReportDocument,
  format: 'pdf' | 'csv' | 'xlsx',
): Promise<Buffer | string> {
  switch (format) {
    case 'pdf':
      return renderReportPdf(report)
    case 'xlsx':
      return renderReportXlsx(report)
    case 'csv':
      return renderReportCsv(report)
  }
}

/**
 * Produces a report and records the run.
 *
 * The row is inserted before the work starts, so a run that fails leaves a record of the attempt
 * with the reason on it. The alternative — inserting the row on success — loses exactly the runs
 * somebody needs to ask about.
 */
export async function exportReport(
  ctx: RequestContext,
  type: ReportType,
  input: ExportReportInput,
): Promise<ProducedReport> {
  const cooperative = ctx.cooperative
  if (!cooperative) throw AppError.noCooperativeAccess()
  requireAvailable(ctx, type)

  const { format, ...params } = input
  const run = await prisma.reportRun.create({
    data: {
      cooperativeId: cooperative.id,
      type,
      params,
      format: DB_FORMATS[format],
      status: 'PENDING',
      generatedById: ctx.user.id,
    },
    select: { id: true },
  })

  try {
    const report = await buildReport(ctx, type, params)
    const body = await render(report, format)

    await prisma.reportRun.update({
      where: { id: run.id },
      data: { status: 'READY', rowCount: report.rowCount, completedAt: new Date() },
    })

    await Promise.all([
      notifyReady(cooperative.id, ctx.user.id, run.id, report),
      writeAudit(
        { ctx },
        {
          action: 'report.exported',
          entityType: 'ReportRun',
          entityId: run.id,
          messageKey: 'audit.report.exported',
          messageParams: {
            report: `report.${type}`,
            format: format.toUpperCase(),
            from: params.from,
            to: params.to,
          },
        },
      ),
    ])

    return {
      filename: filenameFor(cooperative.code, type, params, format),
      contentType: CONTENT_TYPES[format],
      body,
      runId: run.id,
      rowCount: report.rowCount,
    }
  } catch (error) {
    // The reason is stored, because the check constraint on the table refuses a failed run that
    // cannot say why — and because "it did not work" is not something a cooperative can act on.
    await prisma.reportRun
      .update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          errorMessage: reasonFor(error),
          completedAt: new Date(),
        },
      })
      .catch((failure: unknown) => {
        logger.error({ err: failure, runId: run.id }, 'could not mark a report run as failed')
      })
    throw error
  }
}

/** A short, safe reason. Never the stack: a run row is read by staff, not by a developer. */
function reasonFor(error: unknown): string {
  if (error instanceof AppError) return error.messageKey
  if (error instanceof Error && error.message.length > 0) return error.message.slice(0, 280)
  return 'unknown'
}

/**
 * Tells the reader their report is ready.
 *
 * Addressed to the person who asked for it rather than to every member of staff: a report is
 * produced by somebody in particular, and everyone else being told about it is the kind of noise
 * that teaches a cooperative to ignore its notifications. The dedupe key names the run, so a
 * second export raises its own notification rather than being swallowed as a duplicate.
 */
async function notifyReady(
  cooperativeId: string,
  userId: string,
  runId: string,
  report: ReportDocument,
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        cooperativeId,
        userId,
        type: 'REPORT_READY',
        severity: 'INFO',
        messageKey: 'notifications.report.ready',
        messageParams: {
          report: `report.${report.type}`,
          period: report.periodLabel,
        },
        entityType: 'ReportRun',
        entityId: runId,
        actionUrl: `/reports/runs/${runId}`,
        dedupeKey: `report:${runId}`,
      },
    })
  } catch (error) {
    // A report that was produced must not be reported as a failure because its notification could
    // not be written. The file is already on its way to the reader.
    logger.error({ err: error, runId }, 'could not raise a report-ready notification')
  }
}

export interface ReportRunRow {
  id: string
  type: ReportType
  title: string
  format: DbReportFormat
  status: 'PENDING' | 'READY' | 'FAILED'
  from: string | null
  to: string | null
  rowCount: number | null
  errorMessage: string | null
  generatedBy: string | null
  createdAt: string
  completedAt: string | null
  /** False while the report's data has not arrived yet, so the screen can hide the button. */
  downloadable: boolean
}

function paramsOf(value: Prisma.JsonValue): ReportParams | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.from !== 'string' || typeof record.to !== 'string') return null
  return record as unknown as ReportParams
}

function runRow(
  locale: Locale,
  row: {
    id: string
    type: string
    params: Prisma.JsonValue
    format: DbReportFormat
    status: 'PENDING' | 'READY' | 'FAILED'
    rowCount: number | null
    errorMessage: string | null
    createdAt: Date
    completedAt: Date | null
    generatedBy: { fullName: string } | null
  },
): ReportRunRow {
  const params = paramsOf(row.params)
  const type = (REPORT_TYPES as readonly string[]).includes(row.type)
    ? (row.type as ReportType)
    : 'monthly-cooperative'

  return {
    id: row.id,
    type,
    title: reportLabel(locale, `report.${row.type}`),
    format: row.format,
    status: row.status,
    from: params?.from ?? null,
    to: params?.to ?? null,
    rowCount: row.rowCount,
    errorMessage: row.errorMessage,
    generatedBy: row.generatedBy?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    downloadable: row.status === 'READY' && params !== null && REPORTS[type].available,
  }
}

export async function listReportRuns(
  ctx: RequestContext,
  query: ListReportRunsQuery,
): Promise<{ rows: ReportRunRow[]; total: number }> {
  const cooperative = ctx.cooperative
  if (!cooperative) throw AppError.noCooperativeAccess()

  const where: Prisma.ReportRunWhereInput = {
    cooperativeId: cooperative.id,
    ...(query.type ? { type: query.type } : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.reportRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        type: true,
        params: true,
        format: true,
        status: true,
        rowCount: true,
        errorMessage: true,
        createdAt: true,
        completedAt: true,
        generatedBy: { select: { fullName: true } },
      },
    }),
    prisma.reportRun.count({ where }),
  ])

  return { rows: rows.map((row) => runRow(ctx.user.locale, row)), total }
}

/**
 * Produces a past run again, from the parameters stored on it.
 *
 * The run's own permission is checked again rather than trusted from when it was first produced: a
 * member of staff whose role has since been narrowed must not be able to reach last month's money
 * figures through a link to an old run. No new run row is written — this is the same run being
 * read again, and a list of runs that grew every time somebody re-opened one would be useless.
 */
export async function downloadReportRun(
  ctx: RequestContext,
  id: string,
): Promise<ProducedReport & { format: 'pdf' | 'csv' | 'xlsx' }> {
  const cooperative = ctx.cooperative
  if (!cooperative) throw AppError.noCooperativeAccess()

  const run = await prisma.reportRun.findFirst({
    // Scoped by cooperative, so a run belonging to another cooperative is not found rather than
    // refused: a wrong tenant learns nothing about what exists elsewhere.
    where: { id, cooperativeId: cooperative.id },
    select: { id: true, type: true, params: true, format: true, status: true },
  })
  if (!run) throw AppError.notFound()

  const params = paramsOf(run.params)
  if (!params || !(REPORT_TYPES as readonly string[]).includes(run.type)) {
    throw AppError.conflict(
      'errors.reports.runNotReproducible',
      'this run cannot be produced again because what it was asked for is no longer readable',
    )
  }

  const type = run.type as ReportType
  requireAvailable(ctx, type)

  const format = run.format.toLowerCase() as 'pdf' | 'csv' | 'xlsx'
  const report = await buildReport(ctx, type, params)
  const body = await render(report, format)

  return {
    filename: filenameFor(cooperative.code, type, params, format),
    contentType: CONTENT_TYPES[format],
    body,
    runId: run.id,
    rowCount: report.rowCount,
    format,
  }
}
