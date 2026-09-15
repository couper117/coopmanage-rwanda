import type { PageMeta, ReportDocument, ReportFormat, ReportType } from '@coopmanage/shared'
import {
  apiRequest,
  apiRequestCollection,
  apiRequestFile,
  type DownloadedFile,
} from '@/lib/apiClient'

/**
 * Reports, as the interface sees them.
 *
 * A preview comes back as a `ReportDocument` — the same structure the server renders the PDF from —
 * so the screen and the paper are the same document rather than two attempts at it. The screen
 * does not decide what a report contains, or in what order: it walks the sections it was given.
 * That is deliberate, and it is why a section the reader's role does not cover arrives as a
 * `withheld` section with a sentence in it rather than as an absence the screen has to explain.
 */

export interface ReportCatalogueRow {
  type: ReportType
  title: string
  permitted: boolean
  permission: string
  available: boolean
  availableFromPhase: number
  /** Sections this reader will not see, named, so the screen can say so before producing it. */
  withheld: string[]
}

export interface ReportParams {
  from: string
  to: string
  locale?: 'EN' | 'RW'
  memberId?: string
  warehouseId?: string
  categoryId?: string
}

export function listReportCatalogue(): Promise<ReportCatalogueRow[]> {
  return apiRequest<ReportCatalogueRow[]>('/reports')
}

export function previewReport(type: ReportType, params: ReportParams): Promise<ReportDocument> {
  return apiRequest<ReportDocument>(`/reports/${type}/preview`, { method: 'POST', body: params })
}

const ACCEPT: Readonly<Record<ReportFormat, string>> = {
  pdf: 'application/pdf',
  csv: 'text/csv',
  xlsx: 'application/octet-stream',
}

export function exportReport(
  type: ReportType,
  params: ReportParams,
  format: ReportFormat,
): Promise<DownloadedFile> {
  return apiRequestFile(`/reports/${type}/export`, {
    method: 'POST',
    body: { ...params, format },
    accept: ACCEPT[format],
    fallbackFilename: `${type}.${format}`,
  })
}

export interface ReportRunRow {
  id: string
  type: ReportType
  title: string
  format: 'PDF' | 'CSV' | 'XLSX'
  status: 'PENDING' | 'READY' | 'FAILED'
  from: string | null
  to: string | null
  rowCount: number | null
  errorMessage: string | null
  generatedBy: string | null
  createdAt: string
  completedAt: string | null
  downloadable: boolean
}

export function listReportRuns(options: {
  page: number
  pageSize: number
  type?: ReportType
}): Promise<{ items: ReportRunRow[]; meta: PageMeta | undefined }> {
  return apiRequestCollection<ReportRunRow>('/reports/runs', {
    query: {
      page: options.page,
      pageSize: options.pageSize,
      ...(options.type ? { type: options.type } : {}),
    },
  })
}

export function downloadReportRun(run: ReportRunRow): Promise<DownloadedFile> {
  const format = run.format.toLowerCase() as ReportFormat
  return apiRequestFile(`/reports/runs/${run.id}/download`, {
    accept: ACCEPT[format],
    fallbackFilename: `${run.type}.${format}`,
  })
}

/**
 * The first and last day of a month, which is what a report is almost always asked for.
 *
 * Built from the calendar rather than from a library: a month is the period a Rwandan
 * cooperative's committee meets about, and the first thing the screen should offer.
 */
export function monthRange(year: number, month: number): { from: string; to: string } {
  const start = new Date(Date.UTC(year, month, 1))
  const end = new Date(Date.UTC(year, month + 1, 0))
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }
}

/** The month a date falls in, for the screen's default. */
export function currentMonthRange(today = new Date()): { from: string; to: string } {
  return monthRange(today.getUTCFullYear(), today.getUTCMonth())
}
