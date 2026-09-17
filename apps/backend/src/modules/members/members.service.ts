import type { Prisma } from '@prisma/client'
import { auditWithin, writeAudit } from '../../lib/audit.js'
import type { RequestContext } from '../../lib/context.js'
import { isUniqueViolation } from '../../lib/dbErrors.js'
import { csvCell } from '../../lib/csv.js'
import { AppError } from '../../lib/errors.js'
import { multiply, parseMoney, subtract, sum, toWire, ZERO } from '../../lib/money.js'
import { prisma } from '../../lib/prisma.js'
import { nextMemberCode } from '../../lib/references.js'
import { postTransaction, voidTransaction } from '../finance/finance.service.js'
import type {
  CreateMemberInput,
  ListMembersQuery,
  RecordContributionInput,
  RecordShareInput,
  UpdateMemberInput,
} from './members.schemas.js'

/**
 * Members.
 *
 * The register of who belongs to the cooperative, and the two money-facing ledgers that hang off
 * it. Three things govern everything here:
 *
 * - A member needs a name and nothing else. Every other field is optional because the people in
 *   this register frequently have no phone, no email and no card to hand.
 * - Nobody is ever deleted. A member is deactivated, suspended or marked as having left, and the
 *   record stays, because the cooperative's books have to remain defensible years later.
 * - Money is posted through `postTransaction` inside the same database transaction, so a
 *   contribution and its income row either both exist or neither does.
 */

function requireCooperative(ctx: RequestContext): string {
  const id = ctx.cooperative?.id
  if (!id) throw AppError.noCooperativeAccess()
  return id
}

/** A date-only value, at UTC midnight, which is what a `date` column stores. */
function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function today(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function dateOut(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}

/**
 * A national identity number is shown as the last four digits in a list.
 *
 * It is a strong identifier for a real person, and a roster on a shared office screen does not
 * need it in full. The member's own detail view shows it whole, to somebody who may edit the
 * record.
 */
function maskNationalId(value: string | null): string | null {
  if (!value) return null
  return `${'•'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`
}

export interface MemberListRow {
  id: string
  memberCode: string
  firstName: string
  lastName: string
  fullName: string
  gender: string
  phone: string | null
  district: string | null
  sector: string | null
  joinedOn: string
  position: string
  status: string
  nationalIdMasked: string | null
}

export interface MemberDetail extends Omit<MemberListRow, 'nationalIdMasked'> {
  dateOfBirth: string | null
  nationalId: string | null
  email: string | null
  province: string | null
  cell: string | null
  village: string | null
  exitedOn: string | null
  exitReason: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

const LIST_SELECT = {
  id: true,
  memberCode: true,
  firstName: true,
  lastName: true,
  gender: true,
  phone: true,
  district: true,
  sector: true,
  joinedOn: true,
  position: true,
  status: true,
  nationalId: true,
} as const

type ListRow = Prisma.MemberGetPayload<{ select: typeof LIST_SELECT }>

function toListRow(row: ListRow): MemberListRow {
  return {
    id: row.id,
    memberCode: row.memberCode,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`,
    gender: row.gender,
    phone: row.phone,
    district: row.district,
    sector: row.sector,
    joinedOn: dateOut(row.joinedOn) as string,
    position: row.position,
    status: row.status,
    nationalIdMasked: maskNationalId(row.nationalId),
  }
}

/**
 * Builds the `where` clause for the list and the export, so the file a cooperative downloads
 * always contains exactly the rows they were looking at.
 */
function buildWhere(
  cooperativeId: string,
  filters: Omit<ListMembersQuery, 'page' | 'pageSize' | 'sort'>,
): Prisma.MemberWhereInput {
  const search = filters.q?.trim()

  return {
    cooperativeId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.position ? { position: filters.position } : {}),
    ...(filters.gender ? { gender: filters.gender } : {}),
    ...(filters.district ? { district: { equals: filters.district, mode: 'insensitive' } } : {}),
    ...(filters.sector ? { sector: { equals: filters.sector, mode: 'insensitive' } } : {}),
    ...(filters.hasPhone === 'true' ? { phone: { not: null } } : {}),
    ...(filters.hasPhone === 'false' ? { phone: null } : {}),
    ...(filters.joinedFrom || filters.joinedTo
      ? {
          joinedOn: {
            ...(filters.joinedFrom ? { gte: toDateOnly(filters.joinedFrom) } : {}),
            ...(filters.joinedTo ? { lte: toDateOnly(filters.joinedTo) } : {}),
          },
        }
      : {}),
    ...(search
      ? {
          // A secretary types part of a name, part of a code, or the last digits of a phone
          // number. All three are served by the trigram indexes created in migration M4.
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { memberCode: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
          ],
        }
      : {}),
  }
}

function buildOrder(sort: ListMembersQuery['sort']): Prisma.MemberOrderByWithRelationInput[] {
  switch (sort) {
    case '-lastName':
      return [{ lastName: 'desc' }, { firstName: 'desc' }]
    case 'memberCode':
      return [{ memberCode: 'asc' }]
    case '-memberCode':
      return [{ memberCode: 'desc' }]
    case 'joinedOn':
      return [{ joinedOn: 'asc' }, { lastName: 'asc' }]
    case '-joinedOn':
      return [{ joinedOn: 'desc' }, { lastName: 'asc' }]
    default:
      return [{ lastName: 'asc' }, { firstName: 'asc' }]
  }
}

export async function listMembers(
  ctx: RequestContext,
  query: ListMembersQuery,
): Promise<{ items: MemberListRow[]; total: number }> {
  const cooperativeId = requireCooperative(ctx)
  const { page, pageSize, sort, ...filters } = query
  const where = buildWhere(cooperativeId, filters)

  const [rows, total] = await Promise.all([
    prisma.member.findMany({
      where,
      select: LIST_SELECT,
      orderBy: buildOrder(sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.member.count({ where }),
  ])

  return { items: rows.map(toListRow), total }
}

async function findMemberOrThrow(cooperativeId: string, memberId: string) {
  const row = await prisma.member.findFirst({
    where: { id: memberId, cooperativeId },
  })
  if (!row) throw AppError.notFound()
  return row
}

export async function getMember(ctx: RequestContext, memberId: string): Promise<MemberDetail> {
  const cooperativeId = requireCooperative(ctx)
  const row = await findMemberOrThrow(cooperativeId, memberId)

  return {
    id: row.id,
    memberCode: row.memberCode,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`,
    gender: row.gender,
    dateOfBirth: dateOut(row.dateOfBirth),
    nationalId: row.nationalId,
    phone: row.phone,
    email: row.email,
    province: row.province,
    district: row.district,
    sector: row.sector,
    cell: row.cell,
    village: row.village,
    joinedOn: dateOut(row.joinedOn) as string,
    position: row.position,
    status: row.status,
    exitedOn: dateOut(row.exitedOn),
    exitReason: row.exitReason,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Registers a member.
 *
 * The member code is allocated by an atomic increment inside this transaction, so two secretaries
 * registering at the same moment cannot be handed the same code. That is why this is a transaction
 * at all for what looks like a single insert.
 */
export async function createMember(
  ctx: RequestContext,
  input: CreateMemberInput,
): Promise<MemberDetail> {
  const cooperativeId = requireCooperative(ctx)

  const memberId = await prisma.$transaction(async (tx) => {
    const memberCode = await nextMemberCode(tx, cooperativeId)

    const created = await tx.member
      .create({
        data: {
          cooperativeId,
          memberCode,
          firstName: input.firstName,
          lastName: input.lastName,
          gender: input.gender ?? 'UNSPECIFIED',
          dateOfBirth: input.dateOfBirth ? toDateOnly(input.dateOfBirth) : null,
          nationalId: input.nationalId ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          province: input.province ?? null,
          district: input.district ?? null,
          sector: input.sector ?? null,
          cell: input.cell ?? null,
          village: input.village ?? null,
          joinedOn: input.joinedOn ? toDateOnly(input.joinedOn) : today(),
          position: input.position ?? 'MEMBER',
          notes: input.notes ?? null,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        },
        select: { id: true, memberCode: true, firstName: true, lastName: true },
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error, 'national_id')) {
          throw AppError.duplicate('errors.member.nationalIdTaken')
        }
        throw error
      })

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'member.created',
        entityType: 'Member',
        entityId: created.id,
        messageKey: 'audit.member.created',
        messageParams: {
          member: `${created.firstName} ${created.lastName}`,
          code: created.memberCode,
        },
        after: {
          memberCode: created.memberCode,
          firstName: created.firstName,
          lastName: created.lastName,
        },
      },
    )

    return created.id
  })

  return getMember(ctx, memberId)
}

/** Fields whose previous and new values are worth keeping in the trail. */
const AUDITED_FIELDS = [
  'firstName',
  'lastName',
  'gender',
  'dateOfBirth',
  'nationalId',
  'phone',
  'email',
  'province',
  'district',
  'sector',
  'cell',
  'village',
  'joinedOn',
  'position',
] as const

export async function updateMember(
  ctx: RequestContext,
  memberId: string,
  input: UpdateMemberInput,
): Promise<MemberDetail> {
  const cooperativeId = requireCooperative(ctx)
  const before = await getMember(ctx, memberId)

  const data: Prisma.MemberUpdateInput = { updatedBy: { connect: { id: ctx.user.id } } }
  if (input.firstName !== undefined) data.firstName = input.firstName
  if (input.lastName !== undefined) data.lastName = input.lastName
  if (input.gender !== undefined) data.gender = input.gender
  if (input.nationalId !== undefined) data.nationalId = input.nationalId
  if (input.phone !== undefined) data.phone = input.phone
  if (input.email !== undefined) data.email = input.email
  if (input.province !== undefined) data.province = input.province
  if (input.district !== undefined) data.district = input.district
  if (input.sector !== undefined) data.sector = input.sector
  if (input.cell !== undefined) data.cell = input.cell
  if (input.village !== undefined) data.village = input.village
  if (input.position !== undefined) data.position = input.position
  if (input.notes !== undefined) data.notes = input.notes
  if (input.dateOfBirth !== undefined) {
    data.dateOfBirth = input.dateOfBirth ? toDateOnly(input.dateOfBirth) : null
  }
  if (input.joinedOn !== undefined) data.joinedOn = toDateOnly(input.joinedOn)

  try {
    await prisma.member.update({ where: { id: memberId, cooperativeId }, data })
  } catch (error) {
    if (isUniqueViolation(error, 'national_id')) {
      throw AppError.duplicate('errors.member.nationalIdTaken')
    }
    throw error
  }

  const after = await getMember(ctx, memberId)
  const changed = AUDITED_FIELDS.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  )

  if (changed.length > 0) {
    await writeAudit(
      { ctx },
      {
        action: 'member.updated',
        entityType: 'Member',
        entityId: memberId,
        messageKey: 'audit.member.updated',
        messageParams: { member: after.fullName, fields: changed.join(', ') },
        before: Object.fromEntries(changed.map((field) => [field, before[field]])),
        after: Object.fromEntries(changed.map((field) => [field, after[field]])),
      },
    )
  }

  return after
}

/**
 * Changes a member's status. There is no delete.
 *
 * A member who leaves is marked EXITED with the date they left, so the register still shows they
 * were a member for that period — which is exactly what a cooperative needs when a dispute about
 * an old contribution comes up.
 */
export async function setMemberStatus(
  ctx: RequestContext,
  memberId: string,
  input: { status: string; reason?: string | null; exitedOn?: string | null },
): Promise<MemberDetail> {
  const cooperativeId = requireCooperative(ctx)
  const before = await getMember(ctx, memberId)

  if (before.status === input.status) return before

  await prisma.member.update({
    where: { id: memberId, cooperativeId },
    data: {
      status: input.status as 'ACTIVE',
      exitedOn:
        input.status === 'EXITED' ? (input.exitedOn ? toDateOnly(input.exitedOn) : today()) : null,
      exitReason: input.status === 'EXITED' ? (input.reason ?? null) : null,
      updatedBy: { connect: { id: ctx.user.id } },
    },
  })

  const after = await getMember(ctx, memberId)
  await writeAudit(
    { ctx },
    {
      action: 'member.status.changed',
      entityType: 'Member',
      entityId: memberId,
      messageKey: 'audit.member.statusChanged',
      messageParams: {
        member: after.fullName,
        // Translation keys rather than the raw enum values. An audit sentence is read in
        // Kinyarwanda as often as in English, and "ACTIVE" inside a Kinyarwanda sentence is not
        // a translation. The interface resolves any parameter that names a key.
        from: `members.status.${before.status}`,
        to: `members.status.${after.status}`,
      },
      before: { status: before.status, exitedOn: before.exitedOn },
      after: { status: after.status, exitedOn: after.exitedOn, reason: input.reason ?? null },
    },
  )

  return after
}

export interface MemberStats {
  total: number
  byStatus: Record<string, number>
  newThisMonth: number
  withoutPhone: number
}

/**
 * The figures the members screen shows above the table.
 *
 * `withoutPhone` is here deliberately: it is not a data-quality warning but a fact a cooperative
 * needs, because it is the number of members who cannot be reached by SMS when a meeting is
 * called, and who therefore have to be told another way.
 */
export async function memberStats(ctx: RequestContext): Promise<MemberStats> {
  const cooperativeId = requireCooperative(ctx)
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  const [byStatus, total, newThisMonth, withoutPhone] = await Promise.all([
    prisma.member.groupBy({ by: ['status'], where: { cooperativeId }, _count: { _all: true } }),
    prisma.member.count({ where: { cooperativeId } }),
    prisma.member.count({ where: { cooperativeId, joinedOn: { gte: monthStart } } }),
    prisma.member.count({ where: { cooperativeId, phone: null } }),
  ])

  return {
    total,
    byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    newThisMonth,
    withoutPhone,
  }
}

export interface MemberSummary {
  member: MemberDetail
  shares: { quantity: number; value: string } | null
  contributions: { count: number; total: string } | null
  payments: { total: string } | null
  /**
   * Blocks whose tables arrive in a later phase. The profile names them rather than showing a
   * zero, because "none recorded" and "we cannot tell you yet" are different answers and a
   * cooperative should not be shown the wrong one.
   */
  unavailable: string[]
  /** Blocks the caller may not see, so the interface can say so rather than display nothing. */
  withheld: string[]
}

/**
 * The figures behind the member profile.
 *
 * Each block is gated by the permission covering its data, per `docs/permissions.md` section 4, and
 * a block the caller may not see is named in `withheld` rather than silently omitted.
 */
export async function memberSummary(ctx: RequestContext, memberId: string): Promise<MemberSummary> {
  const cooperativeId = requireCooperative(ctx)
  const member = await getMember(ctx, memberId)

  const withheld: string[] = []
  const unavailable: string[] = []

  let shares: MemberSummary['shares'] = null
  if (ctx.permissions.has('shares:view')) {
    const rows = await prisma.memberShare.findMany({
      where: { cooperativeId, memberId, status: 'POSTED' },
      select: { type: true, quantity: true, totalValue: true },
    })
    // Holding is inbound minus outbound, over the ledger. There is no stored balance to drift.
    let quantity = 0
    const inbound: string[] = []
    const outbound: string[] = []
    for (const row of rows) {
      const isInbound = row.type === 'PURCHASE' || row.type === 'TRANSFER_IN'
      quantity += isInbound ? row.quantity : -row.quantity
      ;(isInbound ? inbound : outbound).push(toWire(row.totalValue))
    }
    shares = { quantity, value: toWire(subtract(sum(inbound), sum(outbound))) }
  } else {
    withheld.push('shares')
  }

  let contributions: MemberSummary['contributions'] = null
  if (ctx.permissions.has('contributions:view')) {
    const aggregate = await prisma.contribution.aggregate({
      where: { cooperativeId, memberId, status: 'POSTED' },
      _sum: { amount: true },
      _count: { _all: true },
    })
    contributions = {
      count: aggregate._count._all,
      total: toWire(aggregate._sum.amount ?? ZERO),
    }
  } else {
    withheld.push('contributions')
  }

  let payments: MemberSummary['payments'] = null
  if (ctx.permissions.has('finance:view')) {
    const aggregate = await prisma.financeTransaction.aggregate({
      // A reversal is excluded alongside the entry it corrects, for the reason set out on
      // COUNTS_TOWARDS_TOTALS in the finance module: taking one without the other would apply the
      // correction twice.
      where: {
        cooperativeId,
        memberId,
        kind: 'EXPENSE',
        status: 'POSTED',
        reversalOfId: null,
      },
      _sum: { amount: true },
    })
    payments = { total: toWire(aggregate._sum.amount ?? ZERO) }
  } else {
    withheld.push('payments')
  }

  // Quantity supplied comes from stock receipts, which arrive in Phase 6; attached documents in
  // Phase 9. Named rather than shown as zero.
  unavailable.push('quantitySupplied', 'documents')

  return { member, shares, contributions, payments, unavailable, withheld }
}

export interface TimelineEntry {
  at: string
  kind: 'REGISTERED' | 'STATUS' | 'SHARE' | 'CONTRIBUTION' | 'PAYMENT'
  messageKey: string
  messageParams: Record<string, string | number>
  amount: string | null
}

/**
 * The member's history, newest first, assembled from the ledgers rather than from a separate
 * activity table. Entries the caller may not see are not fetched at all.
 */
export async function memberTimeline(
  ctx: RequestContext,
  memberId: string,
  limit = 50,
): Promise<TimelineEntry[]> {
  const cooperativeId = requireCooperative(ctx)
  const member = await findMemberOrThrow(cooperativeId, memberId)

  const entries: TimelineEntry[] = [
    {
      at: member.joinedOn.toISOString(),
      kind: 'REGISTERED',
      messageKey: 'timeline.registered',
      messageParams: { code: member.memberCode },
      amount: null,
    },
  ]

  if (member.status === 'EXITED' && member.exitedOn) {
    entries.push({
      at: member.exitedOn.toISOString(),
      kind: 'STATUS',
      messageKey: 'timeline.exited',
      messageParams: { reason: member.exitReason ?? '' },
      amount: null,
    })
  }

  if (ctx.permissions.has('shares:view')) {
    const shares = await prisma.memberShare.findMany({
      where: { cooperativeId, memberId, status: 'POSTED' },
      select: { type: true, quantity: true, totalValue: true, issuedOn: true },
      orderBy: { issuedOn: 'desc' },
      take: limit,
    })
    for (const row of shares) {
      entries.push({
        at: row.issuedOn.toISOString(),
        kind: 'SHARE',
        messageKey: `timeline.share.${row.type}`,
        messageParams: { quantity: row.quantity },
        amount: toWire(row.totalValue),
      })
    }
  }

  if (ctx.permissions.has('contributions:view')) {
    const contributions = await prisma.contribution.findMany({
      where: { cooperativeId, memberId, status: 'POSTED' },
      select: { type: true, amount: true, paidOn: true },
      orderBy: { paidOn: 'desc' },
      take: limit,
    })
    for (const row of contributions) {
      entries.push({
        at: row.paidOn.toISOString(),
        kind: 'CONTRIBUTION',
        messageKey: `timeline.contribution.${row.type}`,
        messageParams: {},
        amount: toWire(row.amount),
      })
    }
  }

  if (ctx.permissions.has('finance:view')) {
    // Money paid out to this member, which until Phase 5 could not exist: nothing set a member on
    // a ledger row, so the payments figure on the profile was always nil and this case of the
    // timeline was declared but never produced. A member asking when they were paid needs it.
    const payments = await prisma.financeTransaction.findMany({
      where: {
        cooperativeId,
        memberId,
        kind: 'EXPENSE',
        status: 'POSTED',
        reversalOfId: null,
      },
      select: {
        amount: true,
        occurredAt: true,
        category: { select: { name: true, nameRw: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    })
    for (const row of payments) {
      entries.push({
        at: row.occurredAt.toISOString(),
        kind: 'PAYMENT',
        messageKey: 'timeline.payment',
        messageParams: {
          category: row.category.name,
          categoryRw: row.category.nameRw ?? row.category.name,
        },
        amount: toWire(row.amount),
      })
    }
  }

  return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}

/**
 * Records a share movement, and for a purchase the income it brought in.
 *
 * Both rows are written in one transaction. A purchase that created the share but not the income
 * would leave the cooperative's books short by exactly that amount, with nothing to show why.
 */
export async function recordShare(
  ctx: RequestContext,
  memberId: string,
  input: RecordShareInput,
): Promise<{ id: string; quantity: number; totalValue: string; reference: string | null }> {
  const cooperativeId = requireCooperative(ctx)
  const member = await findMemberOrThrow(cooperativeId, memberId)

  const unitValue = parseMoney(input.unitValue, { field: 'body.unitValue' })
  const totalValue = multiply(unitValue, input.quantity)
  const issuedOn = input.issuedOn ? toDateOnly(input.issuedOn) : today()

  if (input.counterpartyMemberId) {
    // A transfer names another member, who must belong to this cooperative.
    const counterparty = await prisma.member.findFirst({
      where: { id: input.counterpartyMemberId, cooperativeId },
      select: { id: true },
    })
    if (!counterparty) {
      throw AppError.validationFailed([
        { field: 'body.counterpartyMemberId', messageKey: 'validation.invalid_value' },
      ])
    }
  }

  return prisma.$transaction(async (tx) => {
    let financeTransactionId: string | null = null
    let reference: string | null = null

    if (input.type === 'PURCHASE' && input.categoryId) {
      const posted = await postTransaction(tx, ctx, {
        kind: 'INCOME',
        categoryId: input.categoryId,
        amount: totalValue,
        occurredAt: issuedOn,
        method: input.method ?? 'CASH',
        description: `Share capital from ${member.firstName} ${member.lastName} (${member.memberCode})`,
        sourceType: 'SHARE_PURCHASE',
        memberId,
      })
      financeTransactionId = posted.id
      reference = posted.reference
    }

    const share = await tx.memberShare.create({
      data: {
        cooperativeId,
        memberId,
        type: input.type,
        quantity: input.quantity,
        unitValue,
        totalValue,
        issuedOn,
        certificateNo: input.certificateNo ?? null,
        counterpartyMemberId: input.counterpartyMemberId ?? null,
        note: input.note ?? null,
        financeTransactionId,
        createdById: ctx.user.id,
      },
      select: { id: true, quantity: true, totalValue: true },
    })

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'member.share.recorded',
        entityType: 'MemberShare',
        entityId: share.id,
        messageKey: 'audit.member.shareRecorded',
        messageParams: {
          member: `${member.firstName} ${member.lastName}`,
          quantity: share.quantity,
          type: `members.shares.type.${input.type}`,
        },
        after: {
          type: input.type,
          quantity: share.quantity,
          totalValue: toWire(share.totalValue),
          reference,
        },
      },
    )

    return {
      id: share.id,
      quantity: share.quantity,
      totalValue: toWire(share.totalValue),
      reference,
    }
  })
}

/**
 * Records a contribution and the income it is.
 *
 * The contribution is the member-facing view and the finance transaction is the accounting view of
 * the same money. One transaction, so the two can never disagree, and exactly one source of truth
 * for the amount.
 */
export async function recordContribution(
  ctx: RequestContext,
  memberId: string,
  input: RecordContributionInput,
): Promise<{ id: string; amount: string; reference: string }> {
  const cooperativeId = requireCooperative(ctx)
  const member = await findMemberOrThrow(cooperativeId, memberId)

  const amount = parseMoney(input.amount, { field: 'body.amount' })
  const paidOn = input.paidOn ? toDateOnly(input.paidOn) : today()

  return prisma.$transaction(async (tx) => {
    const posted = await postTransaction(tx, ctx, {
      kind: 'INCOME',
      categoryId: input.categoryId,
      amount,
      occurredAt: paidOn,
      method: input.method,
      description: `${input.type} from ${member.firstName} ${member.lastName} (${member.memberCode})`,
      sourceType: 'CONTRIBUTION',
      memberId,
    })

    const contribution = await tx.contribution.create({
      data: {
        cooperativeId,
        memberId,
        type: input.type,
        amount,
        paidOn,
        method: input.method,
        reference: input.reference ?? null,
        note: input.note ?? null,
        financeTransactionId: posted.id,
        createdById: ctx.user.id,
      },
      select: { id: true, amount: true },
    })

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'member.contribution.recorded',
        entityType: 'Contribution',
        entityId: contribution.id,
        messageKey: 'audit.member.contributionRecorded',
        messageParams: {
          member: `${member.firstName} ${member.lastName}`,
          amount: toWire(contribution.amount),
          type: `members.contributions.type.${input.type}`,
        },
        after: {
          type: input.type,
          amount: toWire(contribution.amount),
          method: input.method,
          reference: posted.reference,
        },
      },
    )

    return {
      id: contribution.id,
      amount: toWire(contribution.amount),
      reference: posted.reference,
    }
  })
}

export interface ContributionRow {
  id: string
  memberId: string
  memberCode: string
  memberName: string
  type: string
  amount: string
  paidOn: string
  method: string
  reference: string | null
  status: string
  financeReference: string | null
}

export async function listContributions(
  ctx: RequestContext,
  query: {
    memberId?: string
    type?: string
    from?: string
    to?: string
    status?: string
    page: number
    pageSize: number
  },
): Promise<{ items: ContributionRow[]; total: number; totalAmount: string }> {
  const cooperativeId = requireCooperative(ctx)

  const where: Prisma.ContributionWhereInput = {
    cooperativeId,
    ...(query.memberId ? { memberId: query.memberId } : {}),
    ...(query.type ? { type: query.type as 'SAVINGS' } : {}),
    ...(query.status ? { status: query.status as 'POSTED' } : {}),
    ...(query.from || query.to
      ? {
          paidOn: {
            ...(query.from ? { gte: toDateOnly(query.from) } : {}),
            ...(query.to ? { lte: toDateOnly(query.to) } : {}),
          },
        }
      : {}),
  }

  const [rows, total, aggregate] = await Promise.all([
    prisma.contribution.findMany({
      where,
      select: {
        id: true,
        memberId: true,
        type: true,
        amount: true,
        paidOn: true,
        method: true,
        reference: true,
        status: true,
        member: { select: { memberCode: true, firstName: true, lastName: true } },
        financeTransaction: { select: { reference: true } },
      },
      orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.contribution.count({ where }),
    // The footer total reflects the current filter, and counts only posted rows: a voided
    // contribution is still in the history but is not money the cooperative has.
    prisma.contribution.aggregate({
      where: { ...where, status: 'POSTED' },
      _sum: { amount: true },
    }),
  ])

  return {
    total,
    totalAmount: toWire(aggregate._sum.amount ?? ZERO),
    items: rows.map((row) => ({
      id: row.id,
      memberId: row.memberId,
      memberCode: row.member.memberCode,
      memberName: `${row.member.firstName} ${row.member.lastName}`,
      type: row.type,
      amount: toWire(row.amount),
      paidOn: dateOut(row.paidOn) as string,
      method: row.method,
      reference: row.reference,
      status: row.status,
      financeReference: row.financeTransaction?.reference ?? null,
    })),
  }
}

/**
 * Voids a contribution and reverses the income it posted, in one transaction.
 *
 * Nothing is deleted. Both the contribution and the ledger rows stay visible, so the correction is
 * part of the record rather than a figure that silently changed.
 */
export async function voidContribution(
  ctx: RequestContext,
  contributionId: string,
  reason: string | null,
): Promise<{ id: string; status: string; reversalReference: string | null }> {
  const cooperativeId = requireCooperative(ctx)

  const contribution = await prisma.contribution.findFirst({
    where: { id: contributionId, cooperativeId },
    select: {
      id: true,
      status: true,
      amount: true,
      financeTransactionId: true,
      member: { select: { firstName: true, lastName: true } },
    },
  })
  if (!contribution) throw AppError.notFound()
  if (contribution.status === 'VOID') {
    throw AppError.conflict(
      'errors.contribution.alreadyVoid',
      'That contribution has already been voided.',
    )
  }

  return prisma.$transaction(async (tx) => {
    let reversalReference: string | null = null
    if (contribution.financeTransactionId) {
      const result = await voidTransaction(tx, ctx, contribution.financeTransactionId, reason)
      reversalReference = result.reversal.reference
    }

    await tx.contribution.update({
      where: { id: contributionId },
      data: {
        status: 'VOID',
        voidReason: reason,
        voidedById: ctx.user.id,
        voidedAt: new Date(),
      },
    })

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'member.contribution.voided',
        entityType: 'Contribution',
        entityId: contributionId,
        messageKey: 'audit.member.contributionVoided',
        messageParams: {
          member: `${contribution.member.firstName} ${contribution.member.lastName}`,
          amount: toWire(contribution.amount),
        },
        before: { status: 'POSTED' },
        after: { status: 'VOID', reason, reversal: reversalReference },
      },
    )

    return { id: contributionId, status: 'VOID', reversalReference }
  })
}

/**
 * Voids a share movement recorded in error, and reverses the income a purchase brought in.
 *
 * The same rule as a contribution, for the same reason: nothing is deleted. The movement stays
 * visible with its reason, the holding is recomputed from the remaining POSTED rows, and a
 * purchase's income row is reversed rather than removed so the cooperative's books still add up.
 */
export async function voidShare(
  ctx: RequestContext,
  memberId: string,
  shareId: string,
  reason: string | null,
): Promise<{ id: string; status: string; reversalReference: string | null }> {
  const cooperativeId = requireCooperative(ctx)
  const member = await findMemberOrThrow(cooperativeId, memberId)

  // Scoped to the member as well as the cooperative, so a share id belonging to somebody else
  // reads as not found rather than being voided from the wrong profile.
  const share = await prisma.memberShare.findFirst({
    where: { id: shareId, cooperativeId, memberId },
    select: {
      id: true,
      status: true,
      quantity: true,
      totalValue: true,
      type: true,
      financeTransactionId: true,
    },
  })
  if (!share) throw AppError.notFound()
  if (share.status === 'VOID') {
    throw AppError.conflict(
      'errors.share.alreadyVoid',
      'That share movement has already been voided.',
    )
  }

  return prisma.$transaction(async (tx) => {
    let reversalReference: string | null = null
    if (share.financeTransactionId) {
      const result = await voidTransaction(tx, ctx, share.financeTransactionId, reason)
      reversalReference = result.reversal.reference
    }

    await tx.memberShare.update({
      where: { id: shareId },
      data: {
        status: 'VOID',
        voidReason: reason,
        voidedById: ctx.user.id,
        voidedAt: new Date(),
      },
    })

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'member.share.voided',
        entityType: 'MemberShare',
        entityId: shareId,
        messageKey: 'audit.member.shareVoided',
        messageParams: {
          member: `${member.firstName} ${member.lastName}`,
          quantity: share.quantity,
          type: `members.shares.type.${share.type}`,
        },
        before: { status: 'POSTED', totalValue: toWire(share.totalValue) },
        after: { status: 'VOID', reason, reversal: reversalReference },
      },
    )

    return { id: shareId, status: 'VOID', reversalReference }
  })
}

/**
 * One member's contributions.
 *
 * The member is loaded first, and a member belonging to another cooperative reports "not found".
 * Filtering the list by both the cooperative and the member would have returned an empty list
 * instead — which leaks nothing, but tells the caller the member exists and simply has no
 * contributions. The cross-tenant sweep caught exactly that.
 */
export async function memberContributions(
  ctx: RequestContext,
  memberId: string,
): Promise<{ items: ContributionRow[]; total: number; totalAmount: string }> {
  const cooperativeId = requireCooperative(ctx)
  await findMemberOrThrow(cooperativeId, memberId)
  return listContributions(ctx, { memberId, page: 1, pageSize: 100 })
}

export interface ShareRow {
  id: string
  type: string
  quantity: number
  unitValue: string
  totalValue: string
  issuedOn: string
  certificateNo: string | null
  note: string | null
  status: string
  financeReference: string | null
}

export async function listMemberShares(
  ctx: RequestContext,
  memberId: string,
): Promise<{ items: ShareRow[]; holding: { quantity: number; value: string } }> {
  const cooperativeId = requireCooperative(ctx)
  await findMemberOrThrow(cooperativeId, memberId)

  const rows = await prisma.memberShare.findMany({
    where: { cooperativeId, memberId },
    select: {
      id: true,
      type: true,
      quantity: true,
      unitValue: true,
      totalValue: true,
      issuedOn: true,
      certificateNo: true,
      note: true,
      status: true,
      financeTransaction: { select: { reference: true } },
    },
    orderBy: [{ issuedOn: 'desc' }, { createdAt: 'desc' }],
  })

  let quantity = 0
  const inbound: string[] = []
  const outbound: string[] = []
  for (const row of rows) {
    if (row.status !== 'POSTED') continue
    const isInbound = row.type === 'PURCHASE' || row.type === 'TRANSFER_IN'
    quantity += isInbound ? row.quantity : -row.quantity
    ;(isInbound ? inbound : outbound).push(toWire(row.totalValue))
  }

  return {
    holding: { quantity, value: toWire(subtract(sum(inbound), sum(outbound))) },
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      quantity: row.quantity,
      unitValue: toWire(row.unitValue),
      totalValue: toWire(row.totalValue),
      issuedOn: dateOut(row.issuedOn) as string,
      certificateNo: row.certificateNo,
      note: row.note,
      status: row.status,
      financeReference: row.financeTransaction?.reference ?? null,
    })),
  }
}

/**
 * The member register as CSV, taking the same filters as the list.
 *
 * Values are quoted and internal quotes doubled, which is the whole of the CSV escaping rule and
 * the reason a member called `O'Brien, Jean` does not shift every later column. A leading `=`,
 * `+`, `-` or `@` is prefixed with an apostrophe so a spreadsheet treats it as text rather than a
 * formula.
 */
export async function exportMembersCsv(
  ctx: RequestContext,
  filters: Omit<ListMembersQuery, 'page' | 'pageSize'>,
): Promise<string> {
  const cooperativeId = requireCooperative(ctx)
  const { sort, ...rest } = filters
  const rows = await prisma.member.findMany({
    where: buildWhere(cooperativeId, rest),
    select: { ...LIST_SELECT, email: true, province: true, cell: true, village: true },
    orderBy: buildOrder(sort),
    take: 10_000,
  })

  const header = [
    'Member code',
    'First name',
    'Last name',
    'Gender',
    'Phone',
    'Email',
    'Province',
    'District',
    'Sector',
    'Cell',
    'Village',
    'Joined on',
    'Position',
    'Status',
  ]

  const lines = [header.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.memberCode,
        row.firstName,
        row.lastName,
        row.gender,
        row.phone ?? '',
        row.email ?? '',
        row.province ?? '',
        row.district ?? '',
        row.sector ?? '',
        row.cell ?? '',
        row.village ?? '',
        dateOut(row.joinedOn) ?? '',
        row.position,
        row.status,
      ]
        .map(csvCell)
        .join(','),
    )
  }

  await writeAudit(
    { ctx },
    {
      action: 'member.exported',
      entityType: 'Member',
      messageKey: 'audit.member.exported',
      messageParams: { count: rows.length },
    },
  )

  // A byte order mark, written as an escape so it is visible in the source rather than an
  // invisible character somebody deletes by accident. Excel on Windows needs it to read the
  // Kinyarwanda characters as UTF-8 instead of showing mojibake.
  return `\ufeff${lines.join('\r\n')}\r\n`
}

/** Everything the add-member form needs in one request: the income categories a contribution can use. */
export async function memberFormOptions(ctx: RequestContext): Promise<{
  incomeCategories: { id: string; name: string; nameRw: string | null }[]
}> {
  const cooperativeId = requireCooperative(ctx)
  const categories = await prisma.financeCategory.findMany({
    where: { cooperativeId, kind: 'INCOME', isActive: true },
    select: { id: true, name: true, nameRw: true },
    orderBy: { name: 'asc' },
  })
  return { incomeCategories: categories }
}
