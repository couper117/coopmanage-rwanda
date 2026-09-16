import type { Prisma } from '@prisma/client'
import { writeAudit } from '../../lib/audit.js'
import type { RequestContext } from '../../lib/context.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { smsIsUnicode, smsSegments } from '../../lib/sms/index.js'
import { recipientsFor, sendToRecipients, type SendResult } from '../sms/sms.service.js'
import type {
  ArchiveAnnouncementInput,
  CreateAnnouncementInput,
  ListAnnouncementsQuery,
  PublishAnnouncementInput,
  UpdateAnnouncementInput,
} from './announcements.schemas.js'

/**
 * What the cooperative tells people.
 *
 * Three rules, and the first is the one the whole module is shaped around.
 *
 * **A published announcement's text is fixed.** It can be edited freely as a draft and not at all
 * afterwards, because once it has been published — and very likely sent to five hundred telephones
 * — the record has to say what was sent. A correction is a new announcement, and the old one is
 * archived with a reason. A record whose text could be changed after the fact would let a
 * cooperative appear to have told its members something it never told them.
 *
 * **Publishing and sending are separate decisions.** Publishing puts it on the cooperative's own
 * notice board; sending it as an SMS costs money per member and reaches people who mostly have no
 * other way of being told. So the second is asked for explicitly and never defaulted on.
 *
 * **Who could not be reached is part of the answer.** A phone number is never required of a
 * member, so a cooperative of 120 may only be able to text 78 of them. Every publish reports how
 * many had no number, and the screen says it before the send as well as after: the remaining 42
 * are told by the people who see them, which is a decision the committee makes and the software
 * must not hide.
 */

function requireCooperativeId(ctx: RequestContext): string {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw AppError.noCooperativeAccess()
  return cooperativeId
}

function scopeFor(ctx: RequestContext, id?: string): Prisma.AnnouncementWhereInput {
  return { cooperativeId: requireCooperativeId(ctx), ...(id ? { id } : {}) }
}

const ROW_SELECT = {
  id: true,
  title: true,
  titleRw: true,
  body: true,
  bodyRw: true,
  audience: true,
  status: true,
  publishedAt: true,
  archivedAt: true,
  archiveReason: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { fullName: true } },
  publishedBy: { select: { fullName: true } },
  _count: { select: { messages: true } },
} satisfies Prisma.AnnouncementSelect

type Record_ = Prisma.AnnouncementGetPayload<{ select: typeof ROW_SELECT }>

export interface AnnouncementRow {
  id: string
  title: string
  titleRw: string | null
  body: string
  bodyRw: string | null
  audience: string
  status: string
  publishedAt: string | null
  archivedAt: string | null
  archiveReason: string | null
  createdBy: string | null
  publishedBy: string | null
  /** How many messages this announcement has in the log, so the list can say it was sent. */
  messageCount: number
  /** What one copy costs to carry, and whether the text forces the expensive alphabet. */
  segments: number
  unicode: boolean
  createdAt: string
  updatedAt: string
}

function toRow(record: Record_): AnnouncementRow {
  // The Kinyarwanda body where there is one: that is what most members will actually receive, so
  // it is the one whose cost the interface should be quoting.
  const carried = record.bodyRw ?? record.body
  return {
    id: record.id,
    title: record.title,
    titleRw: record.titleRw,
    body: record.body,
    bodyRw: record.bodyRw,
    audience: record.audience,
    status: record.status,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    archivedAt: record.archivedAt?.toISOString() ?? null,
    archiveReason: record.archiveReason,
    createdBy: record.createdBy?.fullName ?? null,
    publishedBy: record.publishedBy?.fullName ?? null,
    messageCount: record._count.messages,
    segments: smsSegments(carried),
    unicode: smsIsUnicode(carried),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

export async function listAnnouncements(
  ctx: RequestContext,
  query: ListAnnouncementsQuery,
): Promise<{ items: AnnouncementRow[]; total: number }> {
  const where: Prisma.AnnouncementWhereInput = {
    ...scopeFor(ctx),
    ...(query.status ? { status: query.status } : {}),
    ...(query.audience ? { audience: query.audience } : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: 'insensitive' } },
            { titleRw: { contains: query.q, mode: 'insensitive' } },
            { body: { contains: query.q, mode: 'insensitive' } },
            { bodyRw: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const [records, total] = await Promise.all([
    prisma.announcement.findMany({
      where,
      // Drafts and published together, newest first: this list is the history as well as the
      // working set, which is why an archived announcement is still in it.
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: ROW_SELECT,
    }),
    prisma.announcement.count({ where }),
  ])

  return { items: records.map(toRow), total }
}

export async function getAnnouncement(ctx: RequestContext, id: string): Promise<AnnouncementRow> {
  const record = await prisma.announcement.findFirst({
    where: scopeFor(ctx, id),
    select: ROW_SELECT,
  })
  if (!record) throw AppError.notFound()
  return toRow(record)
}

/**
 * How many people this announcement would reach, before it is sent.
 *
 * Asked for by the publish dialog, because the two numbers it returns change the decision: 78 of
 * 120 members can be texted, and the message costs two segments each. A cooperative told that
 * afterwards has already spent the money.
 */
export interface AudiencePreview {
  audience: string
  /** Members in the audience. For a staff announcement this is zero: nobody is texted. */
  total: number
  withPhone: number
  withoutPhone: number
  segments: number
  unicode: boolean
  /** False when the live provider records without delivering, so the dialog can say so. */
  delivers: boolean
}

export async function audiencePreview(ctx: RequestContext, id: string): Promise<AudiencePreview> {
  const cooperativeId = requireCooperativeId(ctx)
  const record = await prisma.announcement.findFirst({
    where: scopeFor(ctx, id),
    select: { audience: true, body: true, bodyRw: true },
  })
  if (!record) throw AppError.notFound()

  const { sms } = await import('../../lib/sms/index.js')
  const carried = record.bodyRw ?? record.body

  if (record.audience === 'STAFF') {
    return {
      audience: record.audience,
      total: 0,
      withPhone: 0,
      withoutPhone: 0,
      segments: smsSegments(carried),
      unicode: smsIsUnicode(carried),
      delivers: sms().delivers,
    }
  }

  const { recipients, withoutPhone } = await recipientsFor(cooperativeId, {
    activeOnly: record.audience === 'ACTIVE_MEMBERS',
  })

  return {
    audience: record.audience,
    total: recipients.length + withoutPhone,
    withPhone: recipients.length,
    withoutPhone,
    segments: smsSegments(carried),
    unicode: smsIsUnicode(carried),
    delivers: sms().delivers,
  }
}

export async function createAnnouncement(
  ctx: RequestContext,
  input: CreateAnnouncementInput,
): Promise<AnnouncementRow> {
  const cooperativeId = requireCooperativeId(ctx)

  const created = await prisma.announcement.create({
    data: {
      cooperativeId,
      title: input.title,
      titleRw: input.titleRw ?? null,
      body: input.body,
      bodyRw: input.bodyRw ?? null,
      audience: input.audience,
      createdById: ctx.user.id,
    },
    select: { id: true, title: true },
  })

  await writeAudit(
    { ctx },
    {
      action: 'announcement.created',
      entityType: 'Announcement',
      entityId: created.id,
      messageKey: 'audit.announcement.created',
      messageParams: { title: created.title, titleRw: input.titleRw ?? created.title },
      after: { title: input.title, audience: input.audience, status: 'DRAFT' },
    },
  )

  return getAnnouncement(ctx, created.id)
}

export async function updateAnnouncement(
  ctx: RequestContext,
  id: string,
  input: UpdateAnnouncementInput,
): Promise<AnnouncementRow> {
  const existing = await prisma.announcement.findFirst({
    where: scopeFor(ctx, id),
    select: { id: true, status: true, title: true, titleRw: true },
  })
  if (!existing) throw AppError.notFound()

  // Fixed once published. This is the rule the module exists to protect.
  if (existing.status !== 'DRAFT') {
    throw AppError.conflict(
      'errors.announcements.notADraft',
      'This announcement has been published, so its text cannot change. Archive it and write a new one.',
    )
  }

  await prisma.announcement.update({
    where: { id },
    data: {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.titleRw === undefined ? {} : { titleRw: input.titleRw }),
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.bodyRw === undefined ? {} : { bodyRw: input.bodyRw }),
      ...(input.audience === undefined ? {} : { audience: input.audience }),
    },
  })

  await writeAudit(
    { ctx },
    {
      action: 'announcement.updated',
      entityType: 'Announcement',
      entityId: id,
      messageKey: 'audit.announcement.updated',
      messageParams: {
        title: input.title ?? existing.title,
        titleRw: input.titleRw ?? existing.titleRw ?? input.title ?? existing.title,
      },
    },
  )

  return getAnnouncement(ctx, id)
}

export interface PublishResult {
  announcement: AnnouncementRow
  /** Null when it was published without sending, which is the default. */
  sms: SendResult | null
}

/**
 * Publishes it, and sends it where the cooperative asked for that.
 *
 * The publish is committed before a single message is attempted. A gateway that is slow or down
 * must not leave an announcement unpublished — the notice board is the cooperative's own record,
 * and the messages are a delivery of it. The log then says exactly what happened to each
 * recipient, and the same publish can be sent again later without sending twice, because the
 * dedupe key names the announcement and the member.
 */
export async function publishAnnouncement(
  ctx: RequestContext,
  id: string,
  input: PublishAnnouncementInput,
): Promise<PublishResult> {
  const cooperativeId = requireCooperativeId(ctx)
  const existing = await prisma.announcement.findFirst({
    where: scopeFor(ctx, id),
    select: {
      id: true,
      status: true,
      title: true,
      titleRw: true,
      body: true,
      bodyRw: true,
      audience: true,
    },
  })
  if (!existing) throw AppError.notFound()

  if (existing.status === 'ARCHIVED') {
    throw AppError.conflict(
      'errors.announcements.archived',
      'This announcement has been archived. Write a new one.',
    )
  }

  if (existing.status === 'DRAFT') {
    await prisma.announcement.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: ctx.user.id },
    })

    await writeAudit(
      { ctx },
      {
        action: 'announcement.published',
        entityType: 'Announcement',
        entityId: id,
        messageKey: 'audit.announcement.published',
        messageParams: {
          title: existing.title,
          titleRw: existing.titleRw ?? existing.title,
          audience: `announcements.audience.${existing.audience}`,
        },
        after: { status: 'PUBLISHED', audience: existing.audience },
      },
    )
  }

  if (!input.sendSms || existing.audience === 'STAFF') {
    return { announcement: await getAnnouncement(ctx, id), sms: null }
  }

  const { recipients, withoutPhone } = await recipientsFor(cooperativeId, {
    activeOnly: existing.audience === 'ACTIVE_MEMBERS',
  })

  // What members receive is the Kinyarwanda text where the cooperative wrote one. A member reading
  // an SMS is not choosing a language in an interface, so the choice is made here and it is the
  // one the cooperative wrote for them.
  const carried = existing.bodyRw ?? existing.body

  const result = await sendToRecipients(ctx, {
    recipients,
    body: carried,
    dedupePrefix: `announcement:${id}`,
    announcementId: id,
    withoutPhone,
  })

  await writeAudit(
    { ctx },
    {
      action: 'announcement.sent',
      entityType: 'Announcement',
      entityId: id,
      messageKey: 'audit.announcement.sent',
      messageParams: {
        title: existing.title,
        titleRw: existing.titleRw ?? existing.title,
        count: result.sent,
      },
      after: {
        sent: result.sent,
        failed: result.failed,
        alreadySent: result.alreadySent,
        withoutPhone: result.withoutPhone,
      },
    },
  )

  return { announcement: await getAnnouncement(ctx, id), sms: result }
}

/** Takes it off the notice board and keeps it in the record, with the reason. */
export async function archiveAnnouncement(
  ctx: RequestContext,
  id: string,
  input: ArchiveAnnouncementInput,
): Promise<AnnouncementRow> {
  const existing = await prisma.announcement.findFirst({
    where: scopeFor(ctx, id),
    select: { id: true, status: true, title: true, titleRw: true },
  })
  if (!existing) throw AppError.notFound()

  if (existing.status === 'ARCHIVED') {
    throw AppError.conflict(
      'errors.announcements.alreadyArchived',
      'This announcement is already archived.',
    )
  }

  /**
   * An abandoned draft keeps no publisher.
   *
   * A draft has never been published, so recording the person who archived it as its publisher
   * would put something in the record that never happened. The check constraint is written to
   * allow exactly this — an archived row may or may not have been published — rather than forcing
   * the service to invent a publisher to satisfy it.
   */
  await prisma.announcement.update({
    where: { id },
    data: { status: 'ARCHIVED', archivedAt: new Date(), archiveReason: input.reason },
  })

  await writeAudit(
    { ctx },
    {
      action: 'announcement.archived',
      entityType: 'Announcement',
      entityId: id,
      messageKey: 'audit.announcement.archived',
      messageParams: {
        title: existing.title,
        titleRw: existing.titleRw ?? existing.title,
        reason: input.reason,
      },
      before: { status: existing.status },
      after: { status: 'ARCHIVED', reason: input.reason },
    },
  )

  return getAnnouncement(ctx, id)
}
