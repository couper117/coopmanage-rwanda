import type { ReportType } from '@coopmanage/shared'
import type { Request, Response } from 'express'
import { buildPageMeta, sendCollection, sendData } from '../../lib/envelope.js'
import { requireContext } from '../../middleware/requirePermission.js'
import type { ExportReportInput, ListReportRunsQuery, ReportParams } from './reports.schemas.js'
import {
  downloadReportRun,
  exportReport,
  listReportCatalogue,
  listReportRuns,
  previewReport,
  type ProducedReport,
} from './reports.service.js'

/**
 * The reports endpoints.
 *
 * A preview answers with the report as data, so the screen renders it with the same components
 * every other screen uses. An export answers with a file, as an attachment with a dated filename,
 * because a cooperative keeps these and has to know months later which period each one covers.
 */

function typeOf(req: Request): ReportType {
  return (req.validated?.params as { type: ReportType }).type
}

// Not async: the catalogue is the shared definitions filtered by what this reader holds, so it
// needs no database call at all. The route wrapper accepts either.
export function getCatalogue(req: Request, res: Response): void {
  sendData(res, listReportCatalogue(requireContext(req)))
}

export async function postPreview(req: Request, res: Response): Promise<void> {
  const params = req.validated?.body as ReportParams
  sendData(res, await previewReport(requireContext(req), typeOf(req), params))
}

function sendFile(res: Response, produced: ProducedReport): void {
  res.setHeader('Content-Type', produced.contentType)
  res.setHeader('Content-Disposition', `attachment; filename="${produced.filename}"`)
  // The run is named in a header as well as in the body of the list, so a client that has just
  // downloaded a file can link to the run it came from without asking again.
  res.setHeader('X-Report-Run-Id', produced.runId)
  res.send(produced.body)
}

export async function postExport(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as ExportReportInput
  sendFile(res, await exportReport(requireContext(req), typeOf(req), input))
}

export async function getRuns(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListReportRunsQuery
  const { rows, total } = await listReportRuns(requireContext(req), query)
  sendCollection(res, rows, buildPageMeta({ page: query.page, pageSize: query.pageSize, total }))
}

export async function getRunDownload(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendFile(res, await downloadReportRun(requireContext(req), id))
}
