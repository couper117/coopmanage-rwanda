import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import type { MessageParams } from '@coopmanage/shared'
import { actorLabel, type RequestContext } from './context.js'
import { logger } from './logger.js'
import { prisma } from './prisma.js'

/**
 * The audit trail. Who did what, when, in which cooperative, and what the record looked like
 * before and after.
 *
 * Two rules make it trustworthy. It is append only — the database refuses an UPDATE or a DELETE on
 * the table, so there is no code path, and no mistake, that can rewrite history. And `before` and
 * `after` pass through the same redaction list as the logger, so a password hash or a token can
 * never be preserved here after being kept out of the log.
 */

/** Field names whose value never reaches the audit trail, whatever the caller passes. */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'token',
  'tokenhash',
  'accesstoken',
  'refreshtoken',
  'nationalid',
  'secret',
])

type Snapshot = Record<string, unknown>

/**
 * Returns Prisma's JSON input type rather than a loose record: the audit columns are jsonb, and a
 * value that cannot be serialised must fail here rather than at the insert.
 */
export function redactSnapshot(input: Snapshot | null | undefined): Prisma.InputJsonObject | null {
  if (!input) return null
  const out: Record<string, Prisma.InputJsonValue | null> = {}
  for (const [key, value] of Object.entries(input)) {
    if (REDACTED_FIELDS.has(key.toLowerCase())) {
      out[key] = '[redacted]'
      continue
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redactSnapshot(value as Snapshot) ?? {}
      continue
    }
    if (value === null || value === undefined) {
      // A cleared field reads as null in the trail rather than vanishing: "phone was set, now it
      // is empty" is exactly the kind of change the log exists to record.
      out[key] = null
      continue
    }
    out[key] = value instanceof Date ? value.toISOString() : value
  }
  return out
}

export interface AuditInput {
  /** Dotted past-tense action: `member.created`, `auth.login.succeeded`. */
  action: string
  entityType: string
  entityId?: string | null
  /** Translation key for the sentence shown in the audit screen. */
  messageKey: string
  messageParams?: MessageParams
  before?: Snapshot | null
  after?: Snapshot | null
  /** Overrides the cooperative from the request context; null writes a platform-level entry. */
  cooperativeId?: string | null
}

interface AuditActor {
  ctx?: RequestContext
  req?: Request
  /** For actions taken before a session exists, such as a failed login. */
  anonymous?: { userId: string | null; label: string }
}

/**
 * Writing the trail must never be the reason a successful action reports failure. An insert that
 * fails is logged at error level and swallowed: the alternative is telling a cooperative that
 * their member was not registered when it was.
 *
 * Anything that must be atomic with its action passes a transaction client instead, through
 * `auditWithin`.
 */
export async function writeAudit(actor: AuditActor, input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({ data: buildRow(actor, input) })
  } catch (error) {
    logger.error({ err: error, action: input.action }, 'failed to write audit entry')
  }
}

/**
 * Writes the trail entry inside the caller's transaction, so the entry and the action it records
 * either both exist or neither does.
 *
 * `writeAudit` deliberately swallows a failure, because telling a cooperative their member was not
 * registered when it was would be worse than a missing log line. That trade-off is wrong for an
 * action whose whole point is being auditable — posting money — so this one lets the error
 * propagate and take the transaction down with it.
 */
export async function auditWithin(
  tx: Prisma.TransactionClient,
  actor: AuditActor,
  input: AuditInput,
): Promise<void> {
  await tx.auditLog.create({ data: buildRow(actor, input) })
}

/** The row, so a caller inside a transaction can insert it with `tx.auditLog.create`. */
export function buildAuditRow(actor: AuditActor, input: AuditInput) {
  return buildRow(actor, input)
}

function buildRow(actor: AuditActor, input: AuditInput) {
  const { ctx, req, anonymous } = actor
  const cooperativeId =
    input.cooperativeId !== undefined ? input.cooperativeId : (ctx?.cooperative?.id ?? null)

  return {
    cooperativeId,
    actorUserId: ctx?.user.id ?? anonymous?.userId ?? null,
    actorLabel: ctx ? actorLabel(ctx.user) : (anonymous?.label ?? 'anonymous'),
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    messageKey: input.messageKey,
    messageParams: (input.messageParams as Prisma.InputJsonValue | undefined) ?? undefined,
    before: redactSnapshot(input.before) ?? undefined,
    after: redactSnapshot(input.after) ?? undefined,
    ipAddress: req?.ip ?? null,
    userAgent: req?.get('user-agent') ?? null,
    requestId: ctx?.requestId ?? req?.requestId ?? null,
  }
}
