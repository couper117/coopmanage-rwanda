import type { AuditEntry, CursorMeta, MessageParams } from '@coopmanage/shared'
import { prisma } from '../../lib/prisma.js'
import type { AuditQuery } from './audit.schemas.js'

/**
 * Reading the trail. Writing it lives in `lib/audit.ts`, because every module writes and only this
 * one reads.
 *
 * Newest first, with cursor paging: the audit log only grows, and offset paging over it would
 * shift every later page each time a row is written and silently skip entries.
 */

/** `createdAt` alone is not unique, so the id breaks ties and keeps the order total. */
function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url')
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [timestamp, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
  if (!timestamp || !id) return null
  const createdAt = new Date(timestamp)
  return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id }
}

export async function listAuditEntries(
  cooperativeId: string,
  query: AuditQuery,
): Promise<{ entries: AuditEntry[]; meta: CursorMeta }> {
  const after = query.cursor ? decodeCursor(query.cursor) : null

  const rows = await prisma.auditLog.findMany({
    where: {
      // The tenant filter is on every audit query, including this one. Platform entries carry a
      // null cooperative and are read through the platform endpoint in Phase 3, never from here.
      cooperativeId,
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(after
        ? {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      actorLabel: true,
      messageKey: true,
      messageParams: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    // One more than asked for, so "is there another page" needs no second count query.
    take: query.limit + 1,
  })

  const page = rows.slice(0, query.limit)
  const last = page.at(-1)

  return {
    entries: page.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actorLabel: row.actorLabel,
      messageKey: row.messageKey,
      messageParams: (row.messageParams as MessageParams | null) ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    meta: {
      limit: query.limit,
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    },
  }
}
