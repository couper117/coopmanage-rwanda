import type { Prisma } from '@prisma/client'
import { auditWithin, writeAudit } from '../../lib/audit.js'
import type { RequestContext } from '../../lib/context.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/prisma.js'
import { nextMeetingReference } from '../../lib/references.js'
import type {
  CreateDecisionInput,
  CreateMeetingInput,
  ListMeetingsQuery,
  PutAgendaInput,
  PutAttendanceInput,
  SetMeetingStatusInput,
  UpdateDecisionInput,
  UpdateMeetingInput,
} from './meetings.schemas.js'

/**
 * Meetings, agendas, attendance and decisions.
 *
 * This is the governance record a Rwandan cooperative is required to keep, and it is designed
 * around what that record has to survive: a dispute years later about whether an assembly could
 * decide what it decided.
 *
 * So **quorum is counted, not asserted**. The number required is stored on the meeting and the
 * number present is counted from attendance taken against the member register. The meeting reports
 * both and whether it was met; nothing anywhere stores "quorum: yes".
 *
 * And **a completed meeting is closed**. Its agenda, its attendance and its decisions' substance
 * stop being editable, because minutes that can be rewritten after the fact are not minutes. What
 * stays open is the follow-up: whether an action was done, who is responsible, by when.
 */

function requireCooperativeId(ctx: RequestContext): string {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw AppError.noCooperativeAccess()
  return cooperativeId
}

export interface AgendaItemRow {
  id: string
  position: number
  title: string
  description: string | null
  presenterStaffId: string | null
  presenterName: string | null
}

export interface AttendeeRow {
  id: string
  memberId: string | null
  staffId: string | null
  guestName: string | null
  /** Whoever the row names, written out: a member's name and code, a staff name, or the guest. */
  name: string
  status: string
  note: string | null
}

export interface DecisionRow {
  id: string
  agendaItemId: string | null
  title: string
  description: string | null
  decisionType: string
  votesFor: number | null
  votesAgainst: number | null
  abstentions: number | null
  dueOn: string | null
  responsibleStaffId: string | null
  responsibleName: string | null
  status: string
  createdAt: string
}

export interface MeetingRow {
  id: string
  reference: string
  title: string
  type: string
  scheduledFor: string
  endsAt: string | null
  location: string | null
  status: string
  quorumRequired: number | null
  notes: string | null
  cancelReason: string | null
  minutesDocumentId: string | null
  minutesTitle: string | null
  createdBy: string | null
  /** Everybody marked present: members, staff and guests. What "who was in the room" means. */
  presentCount: number
  /**
   * Members marked present, which is the only figure quorum is measured against.
   *
   * A quorum is a number of members. A district cooperative officer attending as a guest, or the
   * accountant attending as staff, is in the room and is not a member, and counting either towards
   * the quorum would let an assembly reach one without the members it needs.
   */
  memberPresentCount: number
  attendeeCount: number
  agendaCount: number
  decisionCount: number
  /** Null when the cooperative's rules set no quorum for this meeting. */
  quorumMet: boolean | null
  createdAt: string
  updatedAt: string
}

export interface MeetingDetail extends MeetingRow {
  agenda: AgendaItemRow[]
  attendees: AttendeeRow[]
  decisions: DecisionRow[]
  /** Documents filed against this meeting, minutes included. */
  documents: { id: string; title: string; fileName: string; category: string }[]
}

const LIST_SELECT = {
  id: true,
  reference: true,
  title: true,
  type: true,
  scheduledFor: true,
  endsAt: true,
  location: true,
  status: true,
  quorumRequired: true,
  notes: true,
  cancelReason: true,
  minutesDocumentId: true,
  createdAt: true,
  updatedAt: true,
  minutesDocument: { select: { title: true } },
  createdBy: { select: { fullName: true } },
  _count: { select: { agenda: true, attendees: true, decisions: true } },
} satisfies Prisma.MeetingSelect

type MeetingRecord = Prisma.MeetingGetPayload<{ select: typeof LIST_SELECT }>

interface PresentCounts {
  present: number
  members: number
}

function toRow(record: MeetingRecord, counts: PresentCounts): MeetingRow {
  return {
    id: record.id,
    reference: record.reference,
    title: record.title,
    type: record.type,
    scheduledFor: record.scheduledFor.toISOString(),
    endsAt: record.endsAt?.toISOString() ?? null,
    location: record.location,
    status: record.status,
    quorumRequired: record.quorumRequired,
    notes: record.notes,
    cancelReason: record.cancelReason,
    minutesDocumentId: record.minutesDocumentId,
    minutesTitle: record.minutesDocument?.title ?? null,
    createdBy: record.createdBy?.fullName ?? null,
    presentCount: counts.present,
    memberPresentCount: counts.members,
    attendeeCount: record._count.attendees,
    agendaCount: record._count.agenda,
    decisionCount: record._count.decisions,
    // Measured against the members present, not everybody in the room. Null rather than false
    // where no quorum is set: "not required" and "not met" are different answers, and showing the
    // second for the first would tell a cooperative its assembly was invalid when its own rules
    // say nothing of the kind.
    quorumMet: record.quorumRequired === null ? null : counts.members >= record.quorumRequired,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listMeetings(
  ctx: RequestContext,
  query: ListMeetingsQuery,
): Promise<{ items: MeetingRow[]; total: number }> {
  const cooperativeId = requireCooperativeId(ctx)

  const where: Prisma.MeetingWhereInput = {
    cooperativeId,
    ...(query.type ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.from || query.to
      ? {
          scheduledFor: {
            ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
            ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: 'insensitive' } },
            { reference: { contains: query.q, mode: 'insensitive' } },
            { location: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const [records, total] = await Promise.all([
    prisma.meeting.findMany({
      where,
      orderBy: { scheduledFor: query.sort === 'soonest' ? 'asc' : 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: LIST_SELECT,
    }),
    prisma.meeting.count({ where }),
  ])

  const present = await presentCounts(records.map((record) => record.id))
  return {
    items: records.map((record) =>
      toRow(record, present.get(record.id) ?? { present: 0, members: 0 }),
    ),
    total,
  }
}

/**
 * How many people were present at each of these meetings, and how many of them were members.
 *
 * Grouped in one query rather than counted per meeting, so a page of twenty-five meetings is two
 * queries and not twenty-seven. Both figures come out of the same pass: the members count is what
 * quorum is measured against, and the total is what "who was in the room" means.
 */
async function presentCounts(meetingIds: string[]): Promise<Map<string, PresentCounts>> {
  if (meetingIds.length === 0) return new Map()
  const rows = await prisma.meetingAttendee.findMany({
    where: { meetingId: { in: meetingIds }, status: 'PRESENT' },
    select: { meetingId: true, memberId: true },
  })

  const counts = new Map<string, PresentCounts>()
  for (const row of rows) {
    const current = counts.get(row.meetingId) ?? { present: 0, members: 0 }
    counts.set(row.meetingId, {
      present: current.present + 1,
      members: current.members + (row.memberId === null ? 0 : 1),
    })
  }
  return counts
}

export async function getMeeting(ctx: RequestContext, id: string): Promise<MeetingDetail> {
  const cooperativeId = requireCooperativeId(ctx)
  const record = await prisma.meeting.findFirst({
    where: { id, cooperativeId },
    select: {
      ...LIST_SELECT,
      agenda: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          position: true,
          title: true,
          description: true,
          presenterStaffId: true,
          presenter: { select: { user: { select: { fullName: true } } } },
        },
      },
      attendees: {
        orderBy: [{ status: 'asc' }, { guestName: 'asc' }],
        select: {
          id: true,
          memberId: true,
          staffId: true,
          guestName: true,
          status: true,
          note: true,
          member: { select: { firstName: true, lastName: true, memberCode: true } },
          staff: { select: { user: { select: { fullName: true } } } },
        },
      },
      decisions: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          agendaItemId: true,
          title: true,
          description: true,
          decisionType: true,
          votesFor: true,
          votesAgainst: true,
          abstentions: true,
          dueOn: true,
          responsibleStaffId: true,
          status: true,
          createdAt: true,
          responsible: { select: { user: { select: { fullName: true } } } },
        },
      },
      documents: {
        where: { isArchived: false },
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, fileName: true, category: true },
      },
    },
  })
  // A meeting of another cooperative is not found rather than refused, which is the rule the whole
  // application follows.
  if (!record) throw AppError.notFound()

  const attending = record.attendees.filter((row) => row.status === 'PRESENT')
  const counts: PresentCounts = {
    present: attending.length,
    members: attending.filter((row) => row.memberId !== null).length,
  }

  return {
    ...toRow(record, counts),
    agenda: record.agenda.map((item) => ({
      id: item.id,
      position: item.position,
      title: item.title,
      description: item.description,
      presenterStaffId: item.presenterStaffId,
      presenterName: item.presenter?.user.fullName ?? null,
    })),
    attendees: record.attendees.map((row) => ({
      id: row.id,
      memberId: row.memberId,
      staffId: row.staffId,
      guestName: row.guestName,
      name: row.member
        ? `${row.member.lastName} ${row.member.firstName} (${row.member.memberCode})`
        : (row.staff?.user.fullName ?? row.guestName ?? ''),
      status: row.status,
      note: row.note,
    })),
    decisions: record.decisions.map((row) => ({
      id: row.id,
      agendaItemId: row.agendaItemId,
      title: row.title,
      description: row.description,
      decisionType: row.decisionType,
      votesFor: row.votesFor,
      votesAgainst: row.votesAgainst,
      abstentions: row.abstentions,
      dueOn: row.dueOn?.toISOString().slice(0, 10) ?? null,
      responsibleStaffId: row.responsibleStaffId,
      responsibleName: row.responsible?.user.fullName ?? null,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    })),
    documents: record.documents,
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export async function createMeeting(
  ctx: RequestContext,
  input: CreateMeetingInput,
): Promise<MeetingDetail> {
  const cooperativeId = requireCooperativeId(ctx)
  const scheduledFor = new Date(input.scheduledFor)

  const id = await prisma.$transaction(async (tx) => {
    const reference = await nextMeetingReference(tx, cooperativeId, scheduledFor)
    const meeting = await tx.meeting.create({
      data: {
        cooperativeId,
        reference,
        title: input.title,
        type: input.type,
        scheduledFor,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        location: input.location ?? null,
        quorumRequired: input.quorumRequired ?? null,
        notes: input.notes ?? null,
        createdById: ctx.user.id,
      },
      select: { id: true, reference: true, title: true },
    })

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'meeting.scheduled',
        entityType: 'Meeting',
        entityId: meeting.id,
        messageKey: 'audit.meeting.scheduled',
        messageParams: { reference: meeting.reference, title: meeting.title },
      },
    )

    return meeting.id
  })

  return getMeeting(ctx, id)
}

/** The statuses a meeting may move to from where it is. */
const TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  SCHEDULED: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  // A completed meeting is the record. It does not reopen: a correction is a new meeting, or a
  // decision recorded at the next one.
  COMPLETED: [],
  CANCELLED: [],
}

async function requireOpen(cooperativeId: string, id: string): Promise<{ status: string }> {
  const meeting = await prisma.meeting.findFirst({
    where: { id, cooperativeId },
    select: { status: true },
  })
  if (!meeting) throw AppError.notFound()

  if (meeting.status === 'COMPLETED' || meeting.status === 'CANCELLED') {
    throw AppError.conflict(
      'errors.meetings.closed',
      'This meeting is closed. Its record cannot be changed.',
    )
  }
  return meeting
}

export async function updateMeeting(
  ctx: RequestContext,
  id: string,
  changes: UpdateMeetingInput,
): Promise<MeetingDetail> {
  const cooperativeId = requireCooperativeId(ctx)

  // The minutes may be attached after a meeting has completed — that is the normal order of
  // events — so a change that only attaches or detaches minutes is allowed on a closed meeting,
  // and anything else is not.
  const onlyMinutes = Object.keys(changes).every((key) => key === 'minutesDocumentId')
  const existing = onlyMinutes
    ? await prisma.meeting.findFirst({
        where: { id, cooperativeId },
        select: { status: true },
      })
    : await requireOpen(cooperativeId, id)
  if (!existing) throw AppError.notFound()

  if (changes.minutesDocumentId) {
    const document = await prisma.document.findFirst({
      where: { id: changes.minutesDocumentId, cooperativeId, isArchived: false },
      select: { id: true },
    })
    // Another cooperative's document, or an archived one, is not found: the minutes of a meeting
    // have to be a live document of this cooperative.
    if (!document) throw AppError.notFound()
  }

  const scheduledFor = changes.scheduledFor ? new Date(changes.scheduledFor) : undefined
  const endsAt =
    changes.endsAt === undefined ? undefined : changes.endsAt ? new Date(changes.endsAt) : null

  const record = await prisma.meeting.update({
    where: { id },
    data: {
      ...(changes.title === undefined ? {} : { title: changes.title }),
      ...(changes.type === undefined ? {} : { type: changes.type }),
      ...(scheduledFor === undefined ? {} : { scheduledFor }),
      ...(endsAt === undefined ? {} : { endsAt }),
      ...(changes.location === undefined ? {} : { location: changes.location }),
      ...(changes.quorumRequired === undefined ? {} : { quorumRequired: changes.quorumRequired }),
      ...(changes.notes === undefined ? {} : { notes: changes.notes }),
      ...(changes.minutesDocumentId === undefined
        ? {}
        : { minutesDocumentId: changes.minutesDocumentId }),
    },
    select: { id: true, reference: true },
  })

  await writeAudit(
    { ctx },
    {
      action:
        onlyMinutes && changes.minutesDocumentId ? 'meeting.minutes.attached' : 'meeting.updated',
      entityType: 'Meeting',
      entityId: record.id,
      messageKey:
        onlyMinutes && changes.minutesDocumentId
          ? 'audit.meeting.minutesAttached'
          : 'audit.meeting.updated',
      messageParams: { reference: record.reference },
    },
  )

  return getMeeting(ctx, id)
}

export async function setMeetingStatus(
  ctx: RequestContext,
  id: string,
  input: SetMeetingStatusInput,
): Promise<MeetingDetail> {
  const cooperativeId = requireCooperativeId(ctx)
  const existing = await prisma.meeting.findFirst({
    where: { id, cooperativeId },
    select: { id: true, status: true, reference: true },
  })
  if (!existing) throw AppError.notFound()

  if (existing.status === input.status) {
    throw AppError.conflict(
      'errors.meetings.alreadyInStatus',
      `This meeting is already ${input.status.toLowerCase().replace('_', ' ')}.`,
    )
  }

  const allowed = TRANSITIONS[existing.status] ?? []
  if (!allowed.includes(input.status)) {
    throw new AppError({
      status: 409,
      code: 'INVALID_STATE_TRANSITION',
      messageKey: 'errors.meetings.invalidTransition',
      messageParams: {
        from: `meetings.status.${existing.status}`,
        to: `meetings.status.${input.status}`,
      },
      message: `A meeting cannot go from ${existing.status} to ${input.status}.`,
    })
  }

  // The database insists on a reason for a cancellation, and so does this: "cancelled" with
  // nothing beside it is a question at the next assembly.
  if (input.status === 'CANCELLED' && !input.reason) {
    throw AppError.validationFailed([
      { field: 'body.reason', messageKey: 'validation.meetings.cancelReasonRequired' },
    ])
  }

  await prisma.meeting.update({
    where: { id: existing.id },
    data: {
      status: input.status,
      ...(input.status === 'CANCELLED' ? { cancelReason: input.reason } : {}),
    },
  })

  await writeAudit(
    { ctx },
    {
      action: 'meeting.status.changed',
      entityType: 'Meeting',
      entityId: existing.id,
      messageKey: 'audit.meeting.statusChanged',
      messageParams: {
        reference: existing.reference,
        from: `meetings.status.${existing.status}`,
        to: `meetings.status.${input.status}`,
      },
    },
  )

  return getMeeting(ctx, id)
}

/**
 * Replaces the agenda.
 *
 * Whole-list replacement inside one transaction: the old items go, the new ones are written with
 * positions one upward in the order they arrived. A half-applied reorder would leave two items
 * claiming the same position, which the unique constraint would refuse anyway — so doing it in one
 * transaction is both the simple way and the only correct one.
 *
 * Decisions that pointed at a removed item keep their own record and lose the pointer, which is
 * what `onDelete: SetNull` on the relation is for: what a meeting decided does not stop being true
 * because the agenda was rearranged.
 */
export async function putAgenda(
  ctx: RequestContext,
  id: string,
  input: PutAgendaInput,
): Promise<MeetingDetail> {
  const cooperativeId = requireCooperativeId(ctx)
  await requireOpen(cooperativeId, id)

  const staffIds = input.items
    .map((item) => item.presenterStaffId)
    .filter((value): value is string => typeof value === 'string')
  await requireStaff(cooperativeId, staffIds)

  await prisma.$transaction(async (tx) => {
    await tx.meetingAgendaItem.deleteMany({ where: { meetingId: id } })
    if (input.items.length > 0) {
      await tx.meetingAgendaItem.createMany({
        data: input.items.map((item, index) => ({
          meetingId: id,
          position: index + 1,
          title: item.title,
          description: item.description ?? null,
          presenterStaffId: item.presenterStaffId ?? null,
        })),
      })
    }

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'meeting.agenda.replaced',
        entityType: 'Meeting',
        entityId: id,
        messageKey: 'audit.meeting.agendaReplaced',
        messageParams: { items: input.items.length },
      },
    )
  })

  return getMeeting(ctx, id)
}

/**
 * Records attendance.
 *
 * Also whole-list replacement, for the same reason and one more: attendance is taken in a sitting,
 * and the list at the end of it is the answer. The members named must belong to this cooperative,
 * which is checked in one query rather than trusted — otherwise another cooperative's member could
 * be counted towards this one's quorum.
 */
export async function putAttendance(
  ctx: RequestContext,
  id: string,
  input: PutAttendanceInput,
): Promise<MeetingDetail> {
  const cooperativeId = requireCooperativeId(ctx)
  await requireOpen(cooperativeId, id)

  const memberIds = input.entries
    .map((entry) => entry.memberId)
    .filter((value): value is string => typeof value === 'string')
  const staffIds = input.entries
    .map((entry) => entry.staffId)
    .filter((value): value is string => typeof value === 'string')

  // A member named twice would be one row refused by the unique constraint and the rest of the
  // list lost with it. Caught here so the message names the problem.
  if (new Set(memberIds).size !== memberIds.length) {
    throw AppError.validationFailed([
      { field: 'body.entries', messageKey: 'validation.meetings.duplicateAttendee' },
    ])
  }

  await requireMembers(cooperativeId, memberIds)
  await requireStaff(cooperativeId, staffIds)

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.meetingAttendee.deleteMany({ where: { meetingId: id } })
    if (input.entries.length > 0) {
      await tx.meetingAttendee.createMany({
        data: input.entries.map((entry) => ({
          meetingId: id,
          memberId: entry.memberId ?? null,
          staffId: entry.staffId ?? null,
          guestName: entry.guestName ?? null,
          status: entry.status,
          // Only somebody who was there has a time of arrival.
          checkedInAt: entry.status === 'PRESENT' ? now : null,
          note: entry.note ?? null,
        })),
      })
    }

    await auditWithin(
      tx,
      { ctx },
      {
        action: 'meeting.attendance.recorded',
        entityType: 'Meeting',
        entityId: id,
        messageKey: 'audit.meeting.attendanceRecorded',
        messageParams: {
          present: input.entries.filter((entry) => entry.status === 'PRESENT').length,
          total: input.entries.length,
        },
      },
    )
  })

  return getMeeting(ctx, id)
}

async function requireMembers(cooperativeId: string, memberIds: string[]): Promise<void> {
  if (memberIds.length === 0) return
  const found = await prisma.member.count({
    where: { id: { in: memberIds }, cooperativeId },
  })
  if (found !== new Set(memberIds).size) throw AppError.notFound()
}

async function requireStaff(cooperativeId: string, staffIds: string[]): Promise<void> {
  if (staffIds.length === 0) return
  const unique = Array.from(new Set(staffIds))
  const found = await prisma.cooperativeStaff.count({
    where: { id: { in: unique }, cooperativeId },
  })
  if (found !== unique.length) throw AppError.notFound()
}

export async function createDecision(
  ctx: RequestContext,
  id: string,
  input: CreateDecisionInput,
): Promise<MeetingDetail> {
  const cooperativeId = requireCooperativeId(ctx)
  await requireOpen(cooperativeId, id)

  if (input.agendaItemId) {
    const item = await prisma.meetingAgendaItem.findFirst({
      where: { id: input.agendaItemId, meetingId: id },
      select: { id: true },
    })
    // An agenda item of a different meeting is not found: a decision belongs to the item it was
    // taken under, or to none.
    if (!item) throw AppError.notFound()
  }
  if (input.responsibleStaffId) await requireStaff(cooperativeId, [input.responsibleStaffId])

  const decision = await prisma.meetingDecision.create({
    data: {
      meetingId: id,
      agendaItemId: input.agendaItemId ?? null,
      title: input.title,
      description: input.description ?? null,
      decisionType: input.decisionType,
      votesFor: input.votesFor ?? null,
      votesAgainst: input.votesAgainst ?? null,
      abstentions: input.abstentions ?? null,
      dueOn: input.dueOn ? new Date(`${input.dueOn}T00:00:00.000Z`) : null,
      responsibleStaffId: input.responsibleStaffId ?? null,
    },
    select: { id: true, title: true },
  })

  await writeAudit(
    { ctx },
    {
      action: 'meeting.decision.recorded',
      entityType: 'MeetingDecision',
      entityId: decision.id,
      messageKey: 'audit.meeting.decisionRecorded',
      messageParams: { title: decision.title },
    },
  )

  return getMeeting(ctx, id)
}

/**
 * Updates a decision's follow-up.
 *
 * Allowed on a completed meeting, unlike everything else: an action recorded in March is marked
 * done in June, and a meeting whose actions could never be closed would make the whole decision
 * list useless within a year. What cannot change is the decision itself — its title, its text and
 * its votes — which is why the schema does not accept them.
 */
export async function updateDecision(
  ctx: RequestContext,
  meetingId: string,
  decisionId: string,
  changes: UpdateDecisionInput,
): Promise<MeetingDetail> {
  const cooperativeId = requireCooperativeId(ctx)

  const existing = await prisma.meetingDecision.findFirst({
    where: { id: decisionId, meeting: { id: meetingId, cooperativeId } },
    select: { id: true, title: true },
  })
  if (!existing) throw AppError.notFound()

  if (changes.responsibleStaffId) await requireStaff(cooperativeId, [changes.responsibleStaffId])

  await prisma.meetingDecision.update({
    where: { id: existing.id },
    data: {
      ...(changes.status === undefined ? {} : { status: changes.status }),
      ...(changes.dueOn === undefined
        ? {}
        : { dueOn: changes.dueOn ? new Date(`${changes.dueOn}T00:00:00.000Z`) : null }),
      ...(changes.responsibleStaffId === undefined
        ? {}
        : { responsibleStaffId: changes.responsibleStaffId }),
    },
  })

  await writeAudit(
    { ctx },
    {
      action: 'meeting.decision.updated',
      entityType: 'MeetingDecision',
      entityId: existing.id,
      messageKey: 'audit.meeting.decisionUpdated',
      messageParams: { title: existing.title },
    },
  )

  return getMeeting(ctx, meetingId)
}

/**
 * What the attendance screen needs: the members of the register and the staff.
 *
 * Every active member, because attendance is taken against the register and a member who is not in
 * the list cannot be marked present. Exited members are left out: they are no longer entitled to
 * attend, and including them would invite a quorum counted on people who have left.
 */
export async function attendanceOptions(ctx: RequestContext): Promise<{
  members: { id: string; name: string; memberCode: string; position: string }[]
  staff: { id: string; name: string; roleKey: string }[]
}> {
  const cooperativeId = requireCooperativeId(ctx)

  const [members, staff] = await Promise.all([
    prisma.member.findMany({
      where: { cooperativeId, status: { in: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        memberCode: true,
        position: true,
      },
    }),
    prisma.cooperativeStaff.findMany({
      where: { cooperativeId, status: 'ACTIVE' },
      orderBy: { user: { fullName: 'asc' } },
      select: { id: true, role: { select: { key: true } }, user: { select: { fullName: true } } },
    }),
  ])

  return {
    members: members.map((member) => ({
      id: member.id,
      name: `${member.lastName} ${member.firstName}`,
      memberCode: member.memberCode,
      position: member.position,
    })),
    staff: staff.map((row) => ({
      id: row.id,
      name: row.user.fullName,
      roleKey: row.role.key,
    })),
  }
}
