import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HEADERS } from '@coopmanage/shared'
import { API_PREFIX } from '../src/app.js'
import { disconnectPrisma, prisma } from '../src/lib/prisma.js'
import {
  cleanupFixtures,
  createCooperative,
  createStaffSession,
  type Session,
  type TestCooperative,
  type TestUser,
} from './fixtures.js'
import { testApp } from './server.js'

const app = testApp()

/**
 * Phase 9 — meetings.
 *
 * What these tests hold in place is the governance record, and the two things that make it worth
 * keeping at all.
 *
 * **Quorum is counted, never asserted.** The number required sits on the meeting and the number
 * present is counted from attendance taken against the member register. Nothing stores "quorum:
 * yes", so nothing can say yes when the register says otherwise — and a meeting with no quorum set
 * reports "not required" rather than "not met", which are different answers.
 *
 * **A completed meeting is closed.** Its agenda, its attendance and its decisions stop being
 * editable, because minutes that can be rewritten afterwards are not minutes. The one thing that
 * stays open is the follow-up on an action, because an action recorded in March is marked done in
 * June and a record that could not say so would be useless within a year.
 */

const WHEN = '2026-10-14T08:00:00.000Z'

let cooperative: TestCooperative
let manager: TestUser & Session & { staffId: string }
let secretary: TestUser & Session & { staffId: string }
let accountant: TestUser & Session & { staffId: string }

let other: TestCooperative
let otherManager: TestUser & Session & { staffId: string }
let otherMemberId: string

let memberIds: string[] = []

function as(
  session: Session,
  method: 'get' | 'post' | 'patch' | 'put',
  path: string,
  coop: TestCooperative = cooperative,
) {
  return request(app)
    [method](`${API_PREFIX}${path}`)
    .set('Authorization', `Bearer ${session.accessToken}`)
    .set(HEADERS.cooperativeId, coop.id)
}

interface Detail {
  id: string
  reference: string
  status: string
  quorumRequired: number | null
  quorumMet: boolean | null
  presentCount: number
  memberPresentCount: number
  attendeeCount: number
  minutesDocumentId: string | null
  agenda: { id: string; position: number; title: string; presenterName: string | null }[]
  attendees: { id: string; memberId: string | null; name: string; status: string }[]
  decisions: {
    id: string
    title: string
    status: string
    votesFor: number | null
    agendaItemId: string | null
  }[]
  documents: { id: string; title: string }[]
}

async function schedule(
  overrides: Record<string, unknown> = {},
  session: Session = manager,
): Promise<Detail> {
  const response = await as(session, 'post', '/meetings')
    .send({
      title: 'General assembly',
      type: 'GENERAL_ASSEMBLY',
      scheduledFor: WHEN,
      location: 'Cooperative hall',
      ...overrides,
    })
    .expect(201)
  return response.body.data as Detail
}

beforeAll(async () => {
  cooperative = await createCooperative('Meetings Test Cooperative')
  manager = await createStaffSession(app, cooperative, 'MANAGER')
  secretary = await createStaffSession(app, cooperative, 'SECRETARY')
  accountant = await createStaffSession(app, cooperative, 'ACCOUNTANT')

  other = await createCooperative('Other Meetings Cooperative')
  otherManager = await createStaffSession(app, other, 'MANAGER')

  // Five members, so a quorum can be met and missed with real rows.
  const names = [
    ['Claudine', 'Uwase'],
    ['Alphonse', 'Nsengimana'],
    ['Jeanne', 'Mukamana'],
    ['Eric', 'Mugisha'],
    ['Alice', 'Bizimana'],
  ]
  memberIds = []
  for (const [firstName, lastName] of names) {
    const created = await as(manager, 'post', '/members')
      .send({ firstName, lastName, joinedOn: '2026-01-04' })
      .expect(201)
    memberIds.push(created.body.data.id as string)
  }

  const foreign = await as(otherManager, 'post', '/members', other)
    .send({ firstName: 'Jean', lastName: 'Habimana', joinedOn: '2026-01-04' })
    .expect(201)
  otherMemberId = foreign.body.data.id as string
}, 120_000)

afterAll(async () => {
  await cleanupFixtures()
  await disconnectPrisma()
})

describe('scheduling a meeting', () => {
  it('numbers it within the year, the way a minute book is numbered', async () => {
    const first = await schedule()
    const second = await schedule({ title: 'Board meeting', type: 'BOARD' })

    expect(first.reference).toMatch(/^MTG-2026-\d{6}$/)
    // The seventh meeting of 2026, not the seventh since the system was installed.
    expect(Number(second.reference.slice(-6))).toBe(Number(first.reference.slice(-6)) + 1)
    expect(second.status).toBe('SCHEDULED')
  })

  it('refuses a meeting that ends before it starts', async () => {
    await as(manager, 'post', '/meetings')
      .send({
        title: 'Impossible meeting',
        scheduledFor: WHEN,
        endsAt: '2026-10-14T07:00:00.000Z',
      })
      .expect(422)
  })

  it('needs meetings:manage, which an accountant does not hold', async () => {
    // An accountant presents figures at an assembly they do not run.
    await as(accountant, 'post', '/meetings')
      .send({ title: 'Mine', scheduledFor: WHEN })
      .expect(403)
    // Reading is theirs: the meeting that discusses their figures is worth seeing.
    await as(accountant, 'get', '/meetings').expect(200)
  })

  it('is not visible from another cooperative', async () => {
    const meeting = await schedule({ title: 'Ours alone' })

    await as(otherManager, 'get', `/meetings/${meeting.id}`, other).expect(404)
    await as(otherManager, 'patch', `/meetings/${meeting.id}`, other)
      .send({ title: 'Mine now' })
      .expect(404)
    await as(otherManager, 'put', `/meetings/${meeting.id}/agenda`, other)
      .send({ items: [] })
      .expect(404)
  })

  it('has no delete route: a minute book has no missing numbers', async () => {
    const meeting = await schedule({ title: 'Will be called off' })

    const response = await request(app)
      .delete(`${API_PREFIX}/meetings/${meeting.id}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set(HEADERS.cooperativeId, cooperative.id)
    expect(response.status).toBe(404)

    // Cancelling is the way, and it requires a reason.
    const noReason = await as(manager, 'post', `/meetings/${meeting.id}/status`)
      .send({ status: 'CANCELLED' })
      .expect(422)
    expect(noReason.body.error.details[0].field).toBe('body.reason')

    const cancelled = await as(manager, 'post', `/meetings/${meeting.id}/status`)
      .send({ status: 'CANCELLED', reason: 'The district officer could not attend' })
      .expect(200)
    expect(cancelled.body.data.status).toBe('CANCELLED')
    expect(await prisma.meeting.findUnique({ where: { id: meeting.id } })).not.toBeNull()
  })
})

describe('the agenda', () => {
  it('numbers the items in the order they were sent', async () => {
    const meeting = await schedule({ title: 'Assembly with an agenda' })

    const response = await as(manager, 'put', `/meetings/${meeting.id}/agenda`)
      .send({
        items: [
          { title: 'Opening and attendance' },
          { title: 'The treasurer’s report', presenterStaffId: manager.staffId },
          { title: 'The maize dryer' },
        ],
      })
      .expect(200)

    const detail = response.body.data as Detail
    expect(detail.agenda.map((item) => item.position)).toEqual([1, 2, 3])
    expect(detail.agenda[1]?.title).toBe('The treasurer’s report')
    expect(detail.agenda[1]?.presenterName).toBeTruthy()
  })

  it('replaces the whole list rather than merging into it', async () => {
    const meeting = await schedule({ title: 'Assembly with a changed agenda' })

    await as(manager, 'put', `/meetings/${meeting.id}/agenda`)
      .send({ items: [{ title: 'First' }, { title: 'Second' }, { title: 'Third' }] })
      .expect(200)

    // A reorder with a merge and a drop, which is what editing an agenda actually looks like.
    const response = await as(manager, 'put', `/meetings/${meeting.id}/agenda`)
      .send({ items: [{ title: 'Third' }, { title: 'First and second together' }] })
      .expect(200)

    const detail = response.body.data as Detail
    expect(detail.agenda.map((item) => item.title)).toEqual(['Third', 'First and second together'])
    expect(detail.agenda.map((item) => item.position)).toEqual([1, 2])
  })

  it('refuses a presenter from another cooperative', async () => {
    const meeting = await schedule({ title: 'Assembly with a foreign presenter' })
    await as(manager, 'put', `/meetings/${meeting.id}/agenda`)
      .send({ items: [{ title: 'Something', presenterStaffId: otherManager.staffId }] })
      .expect(404)
  })

  it('keeps a decision whose agenda item was removed', async () => {
    const meeting = await schedule({ title: 'Assembly whose agenda changed under a decision' })
    const withAgenda = (
      await as(manager, 'put', `/meetings/${meeting.id}/agenda`)
        .send({ items: [{ title: 'The dryer' }] })
        .expect(200)
    ).body.data as Detail

    await as(manager, 'post', `/meetings/${meeting.id}/decisions`)
      .send({ title: 'Buy the dryer', agendaItemId: withAgenda.agenda[0]?.id, votesFor: 40 })
      .expect(201)

    const replaced = (
      await as(manager, 'put', `/meetings/${meeting.id}/agenda`)
        .send({ items: [{ title: 'Something else entirely' }] })
        .expect(200)
    ).body.data as Detail

    // What the meeting decided does not stop being true because the agenda was rearranged. The
    // decision survives and loses only its pointer.
    expect(replaced.decisions).toHaveLength(1)
    expect(replaced.decisions[0]?.title).toBe('Buy the dryer')
    expect(replaced.decisions[0]?.agendaItemId).toBeNull()
  })
})

describe('attendance and quorum', () => {
  it('counts the quorum from the register rather than being told it', async () => {
    const meeting = await schedule({ title: 'Assembly with a quorum', quorumRequired: 3 })

    const short = (
      await as(manager, 'put', `/meetings/${meeting.id}/attendance`)
        .send({
          entries: [
            { memberId: memberIds[0], status: 'PRESENT' },
            { memberId: memberIds[1], status: 'PRESENT' },
            { memberId: memberIds[2], status: 'ABSENT' },
            { memberId: memberIds[3], status: 'EXCUSED' },
          ],
        })
        .expect(200)
    ).body.data as Detail

    // Two present of four recorded: the quorum of three is not met, and nothing anywhere was
    // asked whether it was.
    expect(short.presentCount).toBe(2)
    expect(short.attendeeCount).toBe(4)
    expect(short.quorumMet).toBe(false)

    const met = (
      await as(manager, 'put', `/meetings/${meeting.id}/attendance`)
        .send({
          entries: memberIds.slice(0, 4).map((memberId) => ({ memberId, status: 'PRESENT' })),
        })
        .expect(200)
    ).body.data as Detail
    expect(met.presentCount).toBe(4)
    expect(met.quorumMet).toBe(true)
  })

  it('says "not required" rather than "not met" where no quorum is set', async () => {
    const meeting = await schedule({ title: 'Committee meeting with no quorum' })
    const detail = (
      await as(manager, 'put', `/meetings/${meeting.id}/attendance`)
        .send({ entries: [{ memberId: memberIds[0], status: 'PRESENT' }] })
        .expect(200)
    ).body.data as Detail

    // Null, not false. Telling a cooperative its committee meeting was invalid when its own rules
    // set no quorum would be wrong.
    expect(detail.quorumRequired).toBeNull()
    expect(detail.quorumMet).toBeNull()
  })

  it('counts a guest as present without letting them make up the quorum', async () => {
    const meeting = await schedule({ title: 'Assembly with an observer', quorumRequired: 2 })
    const detail = (
      await as(manager, 'put', `/meetings/${meeting.id}/attendance`)
        .send({
          entries: [
            { memberId: memberIds[0], status: 'PRESENT' },
            { staffId: secretary.staffId, status: 'PRESENT' },
            { guestName: 'District cooperative officer', status: 'PRESENT' },
          ],
        })
        .expect(200)
    ).body.data as Detail

    // Three people in the room, one of them a member. A quorum is a number of members, so an
    // assembly cannot reach one on the strength of a visiting officer and the accountant.
    expect(detail.presentCount).toBe(3)
    expect(detail.memberPresentCount).toBe(1)
    expect(detail.quorumMet).toBe(false)

    // And the list agrees with the detail, because both count the same way.
    const list = await as(manager, 'get', '/meetings?pageSize=50').expect(200)
    const row = (list.body.data as Detail[]).find((candidate) => candidate.id === meeting.id)
    expect(row?.presentCount).toBe(3)
    expect(row?.memberPresentCount).toBe(1)
    expect(row?.quorumMet).toBe(false)
  })

  it('takes staff and guests as well as members', async () => {
    const meeting = await schedule({ title: 'Assembly with a guest' })
    const detail = (
      await as(manager, 'put', `/meetings/${meeting.id}/attendance`)
        .send({
          entries: [
            { memberId: memberIds[0], status: 'PRESENT' },
            { staffId: secretary.staffId, status: 'PRESENT' },
            { guestName: 'District cooperative officer', status: 'PRESENT', note: 'Observer' },
          ],
        })
        .expect(200)
    ).body.data as Detail

    expect(detail.attendees).toHaveLength(3)
    expect(detail.attendees.map((row) => row.name)).toContain('District cooperative officer')
    // A member's row is written out with their code, so two members of the same name are
    // distinguishable in the minutes.
    expect(detail.attendees.some((row) => row.name.includes('Uwase'))).toBe(true)
  })

  it('refuses a row naming two people, or none', async () => {
    const meeting = await schedule({ title: 'Assembly with a confused attendee' })

    await as(manager, 'put', `/meetings/${meeting.id}/attendance`)
      .send({ entries: [{ memberId: memberIds[0], guestName: 'Also a guest' }] })
      .expect(422)

    await as(manager, 'put', `/meetings/${meeting.id}/attendance`)
      .send({ entries: [{ status: 'PRESENT' }] })
      .expect(422)
  })

  it('refuses another cooperative’s member, who cannot count towards this quorum', async () => {
    const meeting = await schedule({ title: 'Assembly with a foreign attendee', quorumRequired: 1 })
    await as(manager, 'put', `/meetings/${meeting.id}/attendance`)
      .send({ entries: [{ memberId: otherMemberId, status: 'PRESENT' }] })
      .expect(404)
  })

  it('names a member listed twice rather than losing the whole list to a constraint', async () => {
    const meeting = await schedule({ title: 'Assembly with a duplicate' })
    const response = await as(manager, 'put', `/meetings/${meeting.id}/attendance`)
      .send({
        entries: [
          { memberId: memberIds[0], status: 'PRESENT' },
          { memberId: memberIds[0], status: 'ABSENT' },
        ],
      })
      .expect(422)
    expect(response.body.error.details[0].messageKey).toBe('validation.meetings.duplicateAttendee')
  })

  it('records a time of arrival only for somebody who was there', async () => {
    const meeting = await schedule({ title: 'Assembly with arrival times' })
    await as(manager, 'put', `/meetings/${meeting.id}/attendance`)
      .send({
        entries: [
          { memberId: memberIds[0], status: 'PRESENT' },
          { memberId: memberIds[1], status: 'ABSENT' },
        ],
      })
      .expect(200)

    const rows = await prisma.meetingAttendee.findMany({
      where: { meetingId: meeting.id },
      select: { status: true, checkedInAt: true },
    })
    expect(rows.find((row) => row.status === 'PRESENT')?.checkedInAt).not.toBeNull()
    expect(rows.find((row) => row.status === 'ABSENT')?.checkedInAt).toBeNull()
  })

  it('offers the register to take attendance against', async () => {
    const response = await as(manager, 'get', '/meetings/options').expect(200)
    const options = response.body.data as {
      members: { id: string; name: string; memberCode: string }[]
      staff: { id: string; name: string }[]
    }

    expect(options.members.length).toBeGreaterThanOrEqual(5)
    expect(options.members[0]?.memberCode).toMatch(/-\d{5}$/)
    expect(options.staff.some((row) => row.id === manager.staffId)).toBe(true)
  })
})

describe('decisions', () => {
  let meetingId: string

  beforeAll(async () => {
    const meeting = await schedule({ title: 'Assembly that decided things' })
    meetingId = meeting.id
  })

  it('records the votes as three counts rather than a verdict', async () => {
    const response = await as(manager, 'post', `/meetings/${meetingId}/decisions`)
      .send({
        title: 'Buy a second maize dryer',
        description: 'Before the next harvest, from the equipment reserve',
        decisionType: 'RESOLUTION',
        votesFor: 38,
        votesAgainst: 4,
        abstentions: 2,
      })
      .expect(201)

    const decision = (response.body.data as Detail).decisions[0]
    // Minutes have to show how a decision was carried, not merely that it was.
    expect(decision?.votesFor).toBe(38)
    expect(decision?.status).toBe('OPEN')
  })

  it('refuses a negative vote count', async () => {
    await as(manager, 'post', `/meetings/${meetingId}/decisions`)
      .send({ title: 'Impossible vote', votesFor: -1 })
      .expect(422)
  })

  it('refuses an agenda item belonging to another meeting', async () => {
    const elsewhere = await schedule({ title: 'A different assembly' })
    const withAgenda = (
      await as(manager, 'put', `/meetings/${elsewhere.id}/agenda`)
        .send({ items: [{ title: 'Their item' }] })
        .expect(200)
    ).body.data as Detail

    await as(manager, 'post', `/meetings/${meetingId}/decisions`)
      .send({ title: 'Taken under somebody else’s item', agendaItemId: withAgenda.agenda[0]?.id })
      .expect(404)
  })

  it('lets an action be marked done, and refuses to rewrite what was decided', async () => {
    const created = (
      await as(manager, 'post', `/meetings/${meetingId}/decisions`)
        .send({
          title: 'Repair the store roof',
          decisionType: 'ACTION',
          dueOn: '2026-11-30',
          responsibleStaffId: secretary.staffId,
        })
        .expect(201)
    ).body.data as Detail
    const decisionId = created.decisions.find((row) => row.title === 'Repair the store roof')?.id

    const updated = await as(manager, 'patch', `/meetings/${meetingId}/decisions/${decisionId}`)
      .send({ status: 'DONE' })
      .expect(200)
    expect(
      (updated.body.data as Detail).decisions.find((row) => row.id === decisionId)?.status,
    ).toBe('DONE')

    // The substance of a decision is the minute. The schema does not accept a new title or a new
    // vote count, so there is no request that could change either.
    await as(manager, 'patch', `/meetings/${meetingId}/decisions/${decisionId}`)
      .send({ title: 'Something else entirely' })
      .expect(422)
    await as(manager, 'patch', `/meetings/${meetingId}/decisions/${decisionId}`)
      .send({ votesFor: 100 })
      .expect(422)
  })

  it('refuses a decision of another cooperative’s meeting', async () => {
    const created = (
      await as(manager, 'post', `/meetings/${meetingId}/decisions`)
        .send({ title: 'Ours', decisionType: 'NOTE' })
        .expect(201)
    ).body.data as Detail
    const decisionId = created.decisions.at(-1)?.id

    await as(otherManager, 'patch', `/meetings/${meetingId}/decisions/${decisionId}`, other)
      .send({ status: 'DONE' })
      .expect(404)
  })
})

describe('a meeting’s life', () => {
  it('goes scheduled, under way, completed — and not back', async () => {
    const meeting = await schedule({ title: 'Assembly that ran its course' })

    const begun = await as(manager, 'post', `/meetings/${meeting.id}/status`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200)
    expect(begun.body.data.status).toBe('IN_PROGRESS')

    const done = await as(manager, 'post', `/meetings/${meeting.id}/status`)
      .send({ status: 'COMPLETED' })
      .expect(200)
    expect(done.body.data.status).toBe('COMPLETED')

    // A completed meeting does not reopen: a correction is a new meeting, or a decision recorded
    // at the next one.
    const reopen = await as(manager, 'post', `/meetings/${meeting.id}/status`)
      .send({ status: 'IN_PROGRESS' })
      .expect(409)
    expect(reopen.body.error.code).toBe('INVALID_STATE_TRANSITION')
  })

  it('closes the record once a meeting is completed', async () => {
    const meeting = await schedule({ title: 'Assembly now closed', quorumRequired: 2 })
    await as(manager, 'put', `/meetings/${meeting.id}/agenda`)
      .send({ items: [{ title: 'The only item' }] })
      .expect(200)
    await as(manager, 'put', `/meetings/${meeting.id}/attendance`)
      .send({ entries: memberIds.slice(0, 2).map((memberId) => ({ memberId, status: 'PRESENT' })) })
      .expect(200)
    const created = (
      await as(manager, 'post', `/meetings/${meeting.id}/decisions`)
        .send({ title: 'Something resolved', decisionType: 'ACTION' })
        .expect(201)
    ).body.data as Detail
    const decisionId = created.decisions[0]?.id

    await as(manager, 'post', `/meetings/${meeting.id}/status`)
      .send({ status: 'COMPLETED' })
      .expect(200)

    // Minutes that can be rewritten afterwards are not minutes.
    for (const attempt of [
      as(manager, 'patch', `/meetings/${meeting.id}`).send({ title: 'Renamed after the fact' }),
      as(manager, 'put', `/meetings/${meeting.id}/agenda`).send({ items: [{ title: 'Added' }] }),
      as(manager, 'put', `/meetings/${meeting.id}/attendance`).send({
        entries: memberIds.map((memberId) => ({ memberId, status: 'PRESENT' })),
      }),
      as(manager, 'post', `/meetings/${meeting.id}/decisions`).send({ title: 'One more' }),
    ]) {
      const response = await attempt
      expect(response.status).toBe(409)
      expect(response.body.error.messageKey).toBe('errors.meetings.closed')
    }

    // The follow-up on an action stays open, because an action recorded in March is closed in June.
    await as(manager, 'patch', `/meetings/${meeting.id}/decisions/${decisionId}`)
      .send({ status: 'DONE' })
      .expect(200)
  })

  it('refuses a status it is already in', async () => {
    const meeting = await schedule({ title: 'Assembly asked to stay put' })
    const response = await as(manager, 'post', `/meetings/${meeting.id}/status`)
      .send({ status: 'SCHEDULED' })
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.meetings.alreadyInStatus')
  })
})

describe('the minutes', () => {
  it('are attached after the meeting has closed, which is the normal order', async () => {
    const meeting = await schedule({ title: 'Assembly whose minutes came later' })
    await as(manager, 'post', `/meetings/${meeting.id}/status`)
      .send({ status: 'COMPLETED' })
      .expect(200)

    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('trailer\n%%EOF\n')])
    const document = await as(manager, 'post', '/documents')
      .attach('file', pdf, { filename: 'minutes.pdf', contentType: 'application/pdf' })
      .field('title', 'Minutes of the assembly')
      .field('category', 'MEETING_MINUTES')
      .field('meetingId', meeting.id)
      .expect(201)
    const documentId = document.body.data.id as string

    // Everything else about a closed meeting is fixed, but attaching the minutes is not a change
    // to the record — it is the record arriving.
    const attached = await as(manager, 'patch', `/meetings/${meeting.id}`)
      .send({ minutesDocumentId: documentId })
      .expect(200)
    const detail = attached.body.data as Detail
    expect(detail.minutesDocumentId).toBe(documentId)
    expect(detail.documents.some((row) => row.id === documentId)).toBe(true)

    // And the minutes cannot then be archived out from under the meeting.
    const archive = await as(manager, 'post', `/documents/${documentId}/archive`)
      .send({ reason: 'Tidying up' })
      .expect(409)
    expect(archive.body.error.messageKey).toBe('errors.documents.isMinutes')

    // Detaching first is the way, and then the document may be archived.
    await as(manager, 'patch', `/meetings/${meeting.id}`)
      .send({ minutesDocumentId: null })
      .expect(200)
    await as(manager, 'post', `/documents/${documentId}/archive`)
      .send({ reason: 'Superseded by a corrected copy' })
      .expect(200)
  })

  it('refuses another cooperative’s document as minutes', async () => {
    const meeting = await schedule({ title: 'Assembly offered foreign minutes' })
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('trailer\n%%EOF\n')])
    const foreign = await as(otherManager, 'post', '/documents', other)
      .attach('file', pdf, { filename: 'theirs.pdf', contentType: 'application/pdf' })
      .field('title', 'Their minutes')
      .expect(201)

    await as(manager, 'patch', `/meetings/${meeting.id}`)
      .send({ minutesDocumentId: foreign.body.data.id })
      .expect(404)
  })
})

describe('the list', () => {
  it('finds a meeting by number, title or place', async () => {
    const meeting = await schedule({ title: 'Assembly about the coffee washing station' })

    for (const term of [meeting.reference, 'coffee washing', 'Cooperative hall']) {
      const response = await as(manager, 'get', `/meetings?q=${encodeURIComponent(term)}`).expect(
        200,
      )
      expect(
        (response.body.data as { id: string }[]).some((row) => row.id === meeting.id),
        term,
      ).toBe(true)
    }
  })

  it('filters by kind, state and date, and refuses a filter it does not know', async () => {
    const byType = await as(manager, 'get', '/meetings?type=BOARD').expect(200)
    expect((byType.body.data as { type: string }[]).every((row) => row.type === 'BOARD')).toBe(true)

    const byStatus = await as(manager, 'get', '/meetings?status=CANCELLED').expect(200)
    expect(
      (byStatus.body.data as { status: string }[]).every((row) => row.status === 'CANCELLED'),
    ).toBe(true)

    const inRange = await as(manager, 'get', '/meetings?from=2026-10-01&to=2026-10-31').expect(200)
    expect((inRange.body.data as unknown[]).length).toBeGreaterThan(0)

    await as(manager, 'get', '/meetings?from=2026-10-31&to=2026-10-01').expect(422)
    await as(manager, 'get', '/meetings?kind=BOARD').expect(422)
  })

  it('reports the present count without a query per meeting', async () => {
    const response = await as(manager, 'get', '/meetings?pageSize=50').expect(200)
    const rows = response.body.data as { presentCount: number; quorumMet: boolean | null }[]
    expect(rows.some((row) => row.presentCount > 0)).toBe(true)
    expect(rows.some((row) => row.quorumMet === true)).toBe(true)
  })
})
