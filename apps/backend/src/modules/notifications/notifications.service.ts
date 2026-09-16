import type { Prisma } from '@prisma/client'
import type { RequestContext } from '../../lib/context.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import type { ListNotificationsQuery } from './notifications.schemas.js'

/**
 * The notification centre.
 *
 * Notifications are written by whichever module noticed something — the low-stock watch since
 * Phase 6, a finished report since Phase 8 — as a **key plus parameters**, never as a finished
 * sentence, so the same row reads in English or in Kinyarwanda depending on who opens it. This
 * module is the other half: reading them, and the three things a reader does with one.
 *
 * Three rules, and the second is the one worth arguing about.
 *
 * **Nothing is raised twice.** `(cooperative_id, dedupe_key)` is unique, so a watch that runs after
 * every movement cannot pile up forty copies of the same warning. That is enforced by the database
 * rather than by the code that happens to run.
 *
 * **A notification addressed to the whole cooperative is shared, and marking it read marks it read
 * for everybody.** The row carries one `read_at`, deliberately. A cooperative office is five
 * people, and a low-stock warning is one piece of work: once the storekeeper has seen it, keeping
 * it bold for the manager and the accountant is noise, and noise is how an alert stops being read
 * at all. A notification addressed to one person — `user_id` set — is theirs alone and nobody else
 * ever sees it.
 *
 * **Dismissing is not deleting.** A dismissed row leaves the list and stays in the table, because
 * "was the cooperative warned about this?" is a question somebody asks after the fertiliser ran
 * out. What *is* deleted is a resolved low-stock warning, and only by the watch that raised it —
 * see `inventory/lowStock.ts` for why.
 */

function requireCooperativeId(ctx: RequestContext): string {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw AppError.noCooperativeAccess()
  return cooperativeId
}

/**
 * The rows this reader may see: the cooperative's own, and among those the ones addressed to
 * everybody or to them.
 *
 * Both halves matter. The cooperative clause is the tenant boundary; the user clause is what stops
 * one member of staff reading another's notifications, which in a cooperative can be as sensitive
 * as the record behind it.
 */
function scopeFor(ctx: RequestContext, id?: string): Prisma.NotificationWhereInput {
  return {
    cooperativeId: requireCooperativeId(ctx),
    OR: [{ userId: null }, { userId: ctx.user.id }],
    ...(id ? { id } : {}),
  }
}

const ROW_SELECT = {
  id: true,
  type: true,
  severity: true,
  messageKey: true,
  messageParams: true,
  entityType: true,
  entityId: true,
  actionUrl: true,
  userId: true,
  readAt: true,
  dismissedAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect

type Record_ = Prisma.NotificationGetPayload<{ select: typeof ROW_SELECT }>

export interface NotificationRow {
  id: string
  type: string
  severity: string
  messageKey: string
  messageParams: Record<string, unknown> | null
  entityType: string | null
  entityId: string | null
  /** The screen this notification is about, so a reader can act on it rather than go looking. */
  actionUrl: string | null
  /** True when it was addressed to this reader alone rather than to the whole cooperative. */
  personal: boolean
  readAt: string | null
  createdAt: string
}

function toRow(record: Record_): NotificationRow {
  return {
    id: record.id,
    type: record.type,
    severity: record.severity,
    messageKey: record.messageKey,
    messageParams: (record.messageParams as Record<string, unknown> | null) ?? null,
    entityType: record.entityType,
    entityId: record.entityId,
    actionUrl: record.actionUrl,
    personal: record.userId !== null,
    readAt: record.readAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  }
}

export interface NotificationList {
  items: NotificationRow[]
  total: number
}

export interface NotificationSummary {
  /** What the bell shows. Counted over everything undismissed, not over the current page. */
  unread: number
  /** Unread by category, so the centre can say where the work is without a second request. */
  unreadByType: Record<string, number>
  /** The few most recent unread, so the bell's own list needs no further request. */
  latest: NotificationRow[]
}

export async function listNotifications(
  ctx: RequestContext,
  query: ListNotificationsQuery,
): Promise<NotificationList> {
  const visible = scopeFor(ctx)

  // A dismissed notification is out of the list unless somebody asks to see the dismissed ones,
  // which is how the question "were we warned?" gets answered.
  const where: Prisma.NotificationWhereInput = {
    ...visible,
    ...(query.dismissed === 'only' ? { dismissedAt: { not: null } } : {}),
    ...(query.dismissed === 'exclude' ? { dismissedAt: null } : {}),
    ...(query.unreadOnly ? { readAt: null } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.severity ? { severity: query.severity } : {}),
  }

  const [records, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: ROW_SELECT,
    }),
    prisma.notification.count({ where }),
  ])

  return { items: records.map(toRow), total }
}

/** How many are waiting, by category, and the few most recent — everything the bell draws. */
const LATEST_IN_BELL = 5

export async function notificationSummary(ctx: RequestContext): Promise<NotificationSummary> {
  const unreadWhere: Prisma.NotificationWhereInput = {
    ...scopeFor(ctx),
    dismissedAt: null,
    readAt: null,
  }

  const [unread, byType, latest] = await Promise.all([
    prisma.notification.count({ where: unreadWhere }),
    prisma.notification.groupBy({ by: ['type'], where: unreadWhere, _count: { _all: true } }),
    prisma.notification.findMany({
      where: unreadWhere,
      // Worst first, then newest: a critical warning raised this morning matters more than an
      // information notice raised this afternoon, and the bell shows only five.
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: LATEST_IN_BELL,
      select: ROW_SELECT,
    }),
  ])

  const unreadByType: Record<string, number> = {}
  for (const group of byType) unreadByType[group.type] = group._count._all

  return { unread, unreadByType, latest: latest.map(toRow) }
}

/**
 * Marks one as read.
 *
 * Idempotent: reading it twice is not an error and does not move the timestamp, because the
 * interface marks a notification read the moment it is opened and a second open must not rewrite
 * when it was first seen.
 */
export async function markRead(ctx: RequestContext, id: string): Promise<NotificationRow> {
  const existing = await prisma.notification.findFirst({
    where: scopeFor(ctx, id),
    select: ROW_SELECT,
  })
  // Not found rather than refused: another cooperative's notification, and another person's,
  // should not confirm that it exists.
  if (!existing) throw AppError.notFound()
  if (existing.readAt) return toRow(existing)

  const updated = await prisma.notification.update({
    where: { id },
    data: { readAt: new Date() },
    select: ROW_SELECT,
  })
  return toRow(updated)
}

/** Marks everything this reader can see as read. Returns how many changed, for the confirmation. */
export async function markAllRead(ctx: RequestContext): Promise<{ marked: number }> {
  const result = await prisma.notification.updateMany({
    where: { ...scopeFor(ctx), readAt: null, dismissedAt: null },
    data: { readAt: new Date() },
  })
  return { marked: result.count }
}

/**
 * Takes one out of the list.
 *
 * Dismissing also marks it read, because a notification somebody has decided not to act on has
 * certainly been seen, and leaving it unread would keep it in the bell's count for ever.
 */
export async function dismiss(ctx: RequestContext, id: string): Promise<NotificationRow> {
  const existing = await prisma.notification.findFirst({
    where: scopeFor(ctx, id),
    select: { id: true, readAt: true },
  })
  if (!existing) throw AppError.notFound()

  const now = new Date()
  const updated = await prisma.notification.update({
    where: { id },
    data: { dismissedAt: now, readAt: existing.readAt ?? now },
    select: ROW_SELECT,
  })
  return toRow(updated)
}
