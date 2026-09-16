import type { Prisma } from '@prisma/client'
import { normalizeRwandanPhone } from '@coopmanage/shared'
import type { RequestContext } from '../../lib/context.js'
import { AppError } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'
import { prisma } from '../../lib/prisma.js'
import { sms, smsSegments } from '../../lib/sms/index.js'
import type { ListSmsQuery, SendSmsInput } from './sms.schemas.js'

/**
 * Sending, and the log of everything sent.
 *
 * A cooperative's members mostly do not have smartphones, and the brief is explicit that they must
 * not be made to. SMS is therefore not a convenience feature here; it is how a cooperative reaches
 * the people it exists for — a meeting moved, a price agreed, a delivery date.
 *
 * Four rules.
 *
 * **One row per recipient, written before the provider is called.** Not one row per send: a row
 * per person, with its own outcome, because "which forty-nine of the fifty were told" is the
 * question a committee asks and no provider's dashboard will answer it for them.
 *
 * **The database enforces no duplicates.** `(cooperative_id, dedupe_key)` is unique and the key
 * names what the message is for — an announcement and a member — so publishing the same
 * announcement twice cannot send twice, whatever the code does. That is the exit criterion for
 * this phase made structural rather than careful.
 *
 * **The number and the body are snapshots.** A member changes their telephone and an announcement
 * is archived; what was sent stays what was sent.
 *
 * **A member without a telephone is not a failure.** It is the ordinary case — a phone number is
 * never required of a member anywhere in this product — so such a member is *not* written to the
 * log at all, and the count of who could not be reached is reported separately. A log full of
 * failures for people who never had a number would bury the one failure that matters.
 */

function requireCooperativeId(ctx: RequestContext): string {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw AppError.noCooperativeAccess()
  return cooperativeId
}

export interface SmsRecipient {
  memberId: string
  name: string
  phone: string
}

export interface SendResult {
  /** Messages that left, as far as the provider is concerned. */
  sent: number
  /** Messages the provider refused. Each one is in the log with its reason. */
  failed: number
  /** Recipients already sent this exact message, so nothing was sent again. */
  alreadySent: number
  /** Members with no telephone number. Not failures: the ordinary case, reported so it is seen. */
  withoutPhone: number
  /** What one copy of this message costs to carry, in segments. */
  segments: number
  /** False when the live provider records without delivering, so a screen can say so. */
  delivered: boolean
}

/**
 * Sends one message to each recipient and writes the log.
 *
 * Sequential rather than parallel, and that is deliberate: a gateway rate-limits, and fifty
 * messages arriving at once is how a cooperative's whole announcement gets refused. Fifty
 * sequential calls to a provider that answers in tens of milliseconds is well under a second.
 */
export async function sendToRecipients(
  ctx: RequestContext,
  input: {
    recipients: SmsRecipient[]
    body: string
    /** Names what this send is for, so a repeat of the same thing cannot send twice. */
    dedupePrefix: string
    announcementId?: string | null
    withoutPhone?: number
  },
): Promise<SendResult> {
  const cooperativeId = requireCooperativeId(ctx)
  const provider = sms()
  const sender = await senderName(cooperativeId)

  let sent = 0
  let failed = 0
  let alreadySent = 0

  for (const recipient of input.recipients) {
    const dedupeKey = `${input.dedupePrefix}:member:${recipient.memberId}`

    /**
     * Claim the row first.
     *
     * The unique key is what makes a repeat impossible, and claiming before sending is what makes
     * it impossible in the right direction: a crash between the claim and the provider leaves a
     * QUEUED row that a person can see and act on, where sending first and writing after would
     * leave a message delivered and no record of it.
     */
    const claimed = await prisma.smsMessage
      .create({
        data: {
          cooperativeId,
          announcementId: input.announcementId ?? null,
          memberId: recipient.memberId,
          toPhone: recipient.phone,
          body: input.body,
          status: 'QUEUED',
          provider: provider.name,
          dedupeKey,
          createdById: ctx.user.id,
        },
        select: { id: true },
      })
      .catch((error: unknown) => {
        // Already claimed by an earlier send of the same thing. Not an error: the point of the key.
        if (isAlreadyClaimed(error)) return null
        throw error
      })

    if (!claimed) {
      alreadySent += 1
      continue
    }

    const outcome = await provider.send({
      to: recipient.phone,
      body: input.body,
      sender,
    })

    if (outcome.status === 'SENT') {
      sent += 1
      await prisma.smsMessage.update({
        where: { id: claimed.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          providerMessageId: outcome.providerMessageId,
        },
      })
    } else {
      failed += 1
      await prisma.smsMessage.update({
        where: { id: claimed.id },
        data: { status: 'FAILED', failureReason: outcome.reason },
      })
      logger.warn(
        { memberId: recipient.memberId, provider: provider.name },
        'sms refused by the provider',
      )
    }
  }

  return {
    sent,
    failed,
    alreadySent,
    withoutPhone: input.withoutPhone ?? 0,
    segments: smsSegments(input.body),
    delivered: provider.delivers,
  }
}

function isAlreadyClaimed(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  )
}

/**
 * The name a cooperative's messages appear to come from.
 *
 * The cooperative's own name, trimmed to what a gateway sender id allows, because a member should
 * see who is writing to them. Where the environment names a sender id that wins: a gateway that
 * has assigned one will refuse anything else.
 */
async function senderName(cooperativeId: string): Promise<string | null> {
  const { env } = await import('../../config/env.js')
  if (env.SMS_SENDER_ID) return env.SMS_SENDER_ID
  const cooperative = await prisma.cooperative.findUnique({
    where: { id: cooperativeId },
    select: { name: true },
  })
  if (!cooperative) return null
  return cooperative.name.slice(0, 11)
}

/** The members an ad-hoc send would reach, and how many have no telephone. */
export async function recipientsFor(
  cooperativeId: string,
  options: { memberIds?: string[]; activeOnly: boolean },
): Promise<{ recipients: SmsRecipient[]; withoutPhone: number }> {
  const members = await prisma.member.findMany({
    where: {
      cooperativeId,
      ...(options.memberIds ? { id: { in: options.memberIds } } : {}),
      ...(options.activeOnly ? { status: 'ACTIVE' } : {}),
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: { id: true, firstName: true, lastName: true, phone: true },
  })

  const recipients: SmsRecipient[] = []
  let withoutPhone = 0
  for (const member of members) {
    const phone = normalizeRwandanPhone(member.phone)
    if (!phone) {
      withoutPhone += 1
      continue
    }
    recipients.push({
      memberId: member.id,
      name: `${member.lastName} ${member.firstName}`,
      phone,
    })
  }
  return { recipients, withoutPhone }
}

/** An ad-hoc message to named members. The idempotency key is what makes a retry safe. */
export async function sendToMembers(
  ctx: RequestContext,
  input: SendSmsInput,
  idempotencyKey: string,
): Promise<SendResult> {
  const cooperativeId = requireCooperativeId(ctx)
  const { recipients, withoutPhone } = await recipientsFor(cooperativeId, {
    memberIds: input.memberIds,
    activeOnly: false,
  })

  if (recipients.length === 0 && withoutPhone === 0) {
    throw AppError.validationFailed([
      { field: 'body.memberIds', messageKey: 'validation.invalid_value' },
    ])
  }

  return sendToRecipients(ctx, {
    recipients,
    body: input.body,
    // The client's own key, so pressing Send twice on a hanging request sends once.
    dedupePrefix: `manual:${idempotencyKey}`,
    withoutPhone,
  })
}

const LOG_SELECT = {
  id: true,
  toPhone: true,
  body: true,
  status: true,
  provider: true,
  failureReason: true,
  sentAt: true,
  createdAt: true,
  member: { select: { id: true, firstName: true, lastName: true, memberCode: true } },
  announcement: { select: { id: true, title: true } },
} satisfies Prisma.SmsMessageSelect

export interface SmsLogRow {
  id: string
  toPhone: string
  body: string
  status: string
  provider: string
  failureReason: string | null
  sentAt: string | null
  createdAt: string
  memberId: string | null
  memberName: string | null
  memberCode: string | null
  announcementId: string | null
  announcementTitle: string | null
}

export async function listMessages(
  ctx: RequestContext,
  query: ListSmsQuery,
): Promise<{ items: SmsLogRow[]; total: number; sent: number; failed: number }> {
  const cooperativeId = requireCooperativeId(ctx)
  const where: Prisma.SmsMessageWhereInput = {
    cooperativeId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.announcementId ? { announcementId: query.announcementId } : {}),
    ...(query.memberId ? { memberId: query.memberId } : {}),
  }

  const [records, total, sent, failed] = await Promise.all([
    prisma.smsMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: LOG_SELECT,
    }),
    prisma.smsMessage.count({ where }),
    prisma.smsMessage.count({ where: { cooperativeId, status: 'SENT' } }),
    prisma.smsMessage.count({ where: { cooperativeId, status: 'FAILED' } }),
  ])

  return {
    items: records.map((record) => ({
      id: record.id,
      toPhone: record.toPhone,
      body: record.body,
      status: record.status,
      provider: record.provider,
      failureReason: record.failureReason,
      sentAt: record.sentAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      memberId: record.member?.id ?? null,
      memberName: record.member ? `${record.member.lastName} ${record.member.firstName}` : null,
      memberCode: record.member?.memberCode ?? null,
      announcementId: record.announcement?.id ?? null,
      announcementTitle: record.announcement?.title ?? null,
    })),
    total,
    sent,
    failed,
  }
}
