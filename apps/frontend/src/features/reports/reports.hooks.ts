import type { ReportFormat, ReportType } from '@coopmanage/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApiError } from '@/hooks/useApiErrorMessage'
import { saveFile } from '@/lib/saveFile'
import { useAuthStore } from '@/stores/authStore'
import {
  downloadReportRun,
  exportReport,
  listReportCatalogue,
  listReportRuns,
  previewReport,
  type ReportParams,
  type ReportRunRow,
} from './reports.api'

/**
 * Server state for reports.
 *
 * Every key carries the cooperative it belongs to, so switching tenant cannot show the previous
 * cooperative's figures out of cache — the same rule the other features follow, and the one that
 * matters most here, because a report is the thing somebody reads out at a meeting.
 *
 * A preview is a query even though the endpoint is a `POST`: it reads, it is cached, and it is
 * refetched when the period changes. The method is a `POST` only because its parameters are a
 * body rather than a query string, which keeps a member's identifier out of server logs and
 * browser history.
 */
export const reportKeys = {
  all: ['reports'] as const,
  scope: (cooperativeId: string | null) => ['reports', cooperativeId] as const,
  catalogue: (cooperativeId: string | null) => ['reports', cooperativeId, 'catalogue'] as const,
  preview: (cooperativeId: string | null, type: ReportType, params: ReportParams) =>
    ['reports', cooperativeId, 'preview', type, params] as const,
  runs: (cooperativeId: string | null, page: number, type: ReportType | '') =>
    ['reports', cooperativeId, 'runs', page, type] as const,
}

function useCooperativeId(): string | null {
  return useAuthStore((state) => state.activeCooperativeId)
}

export function useReportCatalogue() {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: reportKeys.catalogue(cooperativeId),
    queryFn: listReportCatalogue,
    enabled: cooperativeId !== null,
    staleTime: 5 * 60 * 1000,
  })
}

export function useReportPreview(type: ReportType, params: ReportParams, enabled: boolean) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: reportKeys.preview(cooperativeId, type, params),
    queryFn: () => previewReport(type, params),
    enabled: enabled && cooperativeId !== null,
    // A report is a statement about a period that has already happened, so it does not go stale
    // while somebody reads it. It is refetched when they ask for it again.
    staleTime: 60 * 1000,
    retry: false,
  })
}

export function useReportRuns(page: number, type: ReportType | '') {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: reportKeys.runs(cooperativeId, page, type),
    queryFn: () => listReportRuns({ page, pageSize: 10, ...(type ? { type } : {}) }),
    enabled: cooperativeId !== null,
  })
}

/**
 * Produces a file and hands it to the browser.
 *
 * The list of runs is refetched afterwards, because the export has just added one to it, and a
 * cooperative that produced a report and saw no record of it would produce it again.
 */
export function useExportReport() {
  const client = useQueryClient()
  const cooperativeId = useCooperativeId()

  return useMutation({
    mutationFn: (input: { type: ReportType; params: ReportParams; format: ReportFormat }) =>
      exportReport(input.type, input.params, input.format),
    onSuccess: (file) => {
      saveFile(file)
      void client.invalidateQueries({ queryKey: reportKeys.scope(cooperativeId) })
    },
  })
}

export function useDownloadRun() {
  return useMutation({
    mutationFn: (run: ReportRunRow) => downloadReportRun(run),
    onSuccess: saveFile,
  })
}

export function useReportsError() {
  return useApiError()
}
