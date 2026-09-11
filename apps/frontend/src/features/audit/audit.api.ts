import type { AuditEntry, CursorMeta } from '@coopmanage/shared'
import { apiRequestCursor } from '@/lib/apiClient'

export interface AuditFilters {
  entityType?: string
  from?: string
  to?: string
}

/**
 * The audit log is read newest-first with a cursor rather than a page number: it only grows, and
 * a row written between two requests would shift every offset page and hide an entry.
 */
export function fetchAuditPage(
  filters: AuditFilters,
  cursor?: string,
): Promise<{ items: AuditEntry[]; meta: CursorMeta | undefined }> {
  return apiRequestCursor<AuditEntry>('/audit', {
    query: { limit: 25, cursor, ...filters },
  })
}
