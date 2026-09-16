import { randomUUID } from 'node:crypto'
import { globSync, readFileSync } from 'node:fs'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HEADERS } from '@coopmanage/shared'
import { API_PREFIX } from '../src/app.js'
import { disconnectPrisma, prisma } from '../src/lib/prisma.js'
import { sms } from '../src/lib/sms/index.js'
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
 * Phase 12 — announcements and the SMS that carries them.
 *
 * The exit criterion is three claims, and each is checked here rather than asserted:
 *
 * - **development runs with no SMS credentials** — the live provider is the mock, it needs nothing,
 *   and it says of itself that it does not deliver, so no screen can imply that members were told;
 * - **sending to fifty members produces fifty logged messages and no duplicates** — fifty members
 *   are created with telephones, the announcement is published twice, and the log is counted;
 * - **provider replacement touches exactly one file** — proved structurally, by reading the source
 *   for anything outside `lib/sms/` that knows a provider exists.
 *
 * Two rules of this module get as much attention as the criteria, because getting them wrong would
 * be worse than not shipping the module. A published announcement's text can never change, and a
 * member without a telephone is the ordinary case rather than a failure.
 */

let cooperative: TestCooperative
let manager: TestUser & Session & { staffId: string }
let secretary: TestUser & Session & { staffId: string }
let accountant: TestUser & Session & { staffId: string }

let other: TestCooperative
let otherManager: TestUser & Session & { staffId: string }

function as(
  session: Session,
  method: 'get' | 'post' | 'patch',
  path: string,
  coop: TestCooperative = cooperative,
) {
  return request(app)
    [method](`${API_PREFIX}${path}`)
    .set('Authorization', `Bearer ${session.accessToken}`)
    .set(HEADERS.cooperativeId, coop.id)
}

/** A send needs an idempotency key, so every call that sends supplies a fresh one. */
function sending(
  session: Session,
  method: 'post',
  path: string,
  coop: TestCooperative = cooperative,
) {
  return as(session, method, path, coop).set(HEADERS.idempotencyKey, randomUUID())
}

interface Announcement {
  id: string
  title: string
  titleRw: string | null
  body: string
  bodyRw: string | null
  audience: string
  status: string
  publishedAt: string | null
  publishedBy: string | null
  archivedAt: string | null
  archiveReason: string | null
  messageCount: number
  segments: number
  unicode: boolean
}

interface SendResult {
  sent: number
  failed: number
  alreadySent: number
  withoutPhone: number
  segments: number
  delivered: boolean
}

async function draft(overrides: Record<string, unknown> = {}): Promise<Announcement> {
  const response = await as(secretary, 'post', '/announcements')
    .send({
      title: 'The assembly has moved to Saturday',
      body: 'The general assembly is now on Saturday at nine in the morning, at the cooperative hall.',
      ...overrides,
    })
    .expect(201)
  return response.body.data as Announcement
}

/** Fifty members with telephones, which is what the exit criterion counts. */
async function createMembersWithPhones(count: number, from = 100): Promise<string[]> {
  const ids: string[] = []
  for (let index = 0; index < count; index += 1) {
    const digits = String(from + index).padStart(6, '0')
    const created = await as(manager, 'post', '/members')
      .send({
        firstName: 'Umunyamuryango',
        lastName: `Wa ${index + 1}`,
        phone: `078${digits.slice(0, 3)}${digits.slice(3)}`.padEnd(10, '0'),
      })
      .expect(201)
    ids.push(created.body.data.id as string)
  }
  return ids
}

beforeAll(async () => {
  cooperative = await createCooperative('Announcements Test Cooperative')
  manager = await createStaffSession(app, cooperative, 'MANAGER')
  secretary = await createStaffSession(app, cooperative, 'SECRETARY')
  accountant = await createStaffSession(app, cooperative, 'ACCOUNTANT')

  other = await createCooperative('Other Announcements Cooperative')
  otherManager = await createStaffSession(app, other, 'MANAGER')
}, 60_000)

afterAll(async () => {
  await cleanupFixtures()
  await disconnectPrisma()
})

describe('the provider development runs on', () => {
  it('needs no credentials and says of itself that it does not deliver', () => {
    const provider = sms()
    expect(provider.name).toBe('mock')
    // The whole point. A mock that claimed to deliver would let a cooperative believe its members
    // were told, which is worse than having no SMS at all.
    expect(provider.delivers).toBe(false)
  })

  it('tells the screens which provider is live and whether it delivers', async () => {
    const response = await as(secretary, 'get', '/sms/provider').expect(200)
    expect(response.body.data).toEqual({ provider: 'mock', delivers: false })
  })

  it('is the only provider anything outside lib/sms knows about', () => {
    // The structural half of "provider replacement touches exactly one file". Nothing outside the
    // driver directory may name a provider class or import one, so adding a real gateway is a new
    // file beside `mock.ts` and a branch in `index.ts` — and no module changes.
    const sources = globSync('src/**/*.ts').filter((file) => !file.includes('src/lib/sms/'))
    const offenders = sources.filter((file) => {
      const text = readFileSync(file, 'utf8')
      return /MockSmsProvider|lib\/sms\/mock/.test(text)
    })
    expect(offenders, `these files know about a provider: ${offenders.join(', ')}`).toEqual([])
  })
})

describe('writing an announcement', () => {
  it('starts as a draft nobody has been sent', async () => {
    const created = await draft()
    expect(created.status).toBe('DRAFT')
    expect(created.publishedAt).toBeNull()
    expect(created.messageCount).toBe(0)
  })

  it('quotes what one copy will cost to carry', async () => {
    const short = await draft({ title: 'Short notice', body: 'Meeting at nine.' })
    expect(short.segments).toBe(1)
    expect(short.unicode).toBe(false)

    const long = await draft({ title: 'Long notice', body: 'a'.repeat(200) })
    // Over 160 characters is two segments, which is twice the money for five hundred members.
    expect(long.segments).toBe(2)
  })

  it('can be edited freely while it is a draft', async () => {
    const created = await draft()
    const updated = await as(secretary, 'patch', `/announcements/${created.id}`)
      .send({
        body: 'The assembly is now on Sunday at nine.',
        bodyRw: 'Inteko rusange ubu ni ku cyumweru saa tatu.',
      })
      .expect(200)
    expect((updated.body.data as Announcement).bodyRw).toContain('cyumweru')
  })

  it('refuses a body that would cost more than four messages', async () => {
    await as(secretary, 'post', '/announcements')
      .send({ title: 'Far too long', body: 'a'.repeat(700) })
      .expect(422)
  })

  it('is refused to a role that may read the notice board but not write to it', async () => {
    // The accountant sees announcements and cannot publish them: publishing spends the
    // cooperative's money and reaches every member's telephone.
    await as(accountant, 'post', '/announcements')
      .send({ title: 'From the wrong desk', body: 'This should not be written from here.' })
      .expect(403)
    await as(accountant, 'get', '/announcements').expect(200)
  })
})

describe('publishing', () => {
  it('publishes without sending unless sending was asked for', async () => {
    const created = await draft()
    const response = await sending(secretary, 'post', `/announcements/${created.id}/publish`)
      .send({ sendSms: false })
      .expect(200)

    const result = response.body.data as { announcement: Announcement; sms: SendResult | null }
    expect(result.announcement.status).toBe('PUBLISHED')
    // Somebody published it, and the record says who.
    expect(result.announcement.publishedBy).toBeTruthy()
    // Nothing was sent, and nothing pretends otherwise.
    expect(result.sms).toBeNull()
  })

  it('will not let a published announcement be edited', async () => {
    const created = await draft()
    await sending(secretary, 'post', `/announcements/${created.id}/publish`)
      .send({ sendSms: false })
      .expect(200)

    // The rule the module exists to protect: once it has gone to five hundred telephones, the
    // record has to say what was sent.
    const refused = await as(secretary, 'patch', `/announcements/${created.id}`)
      .send({ body: 'Quietly corrected after the fact.' })
      .expect(409)
    expect(refused.body.error.messageKey).toBe('errors.announcements.notADraft')
  })

  it('sends nothing for a staff announcement, whatever was asked for', async () => {
    const created = await draft({ audience: 'STAFF' })
    const response = await sending(secretary, 'post', `/announcements/${created.id}/publish`)
      .send({ sendSms: true })
      .expect(200)
    // A staff notice is read in the application by the people who work there. Texting it to the
    // members would be sending them somebody else's message.
    expect((response.body.data as { sms: SendResult | null }).sms).toBeNull()
  })
})

describe('what the cooperative is told before it sends', () => {
  it('counts the members who have no telephone, because that is the ordinary case', async () => {
    const created = await draft({ audience: 'ALL_MEMBERS' })
    await as(manager, 'post', '/members')
      .send({ firstName: 'Ntamakuru', lastName: 'Watelefone' })
      .expect(201)

    const preview = (
      await as(secretary, 'get', `/announcements/${created.id}/audience`).expect(200)
    ).body.data as {
      total: number
      withPhone: number
      withoutPhone: number
      segments: number
      delivers: boolean
    }

    expect(preview.total).toBe(preview.withPhone + preview.withoutPhone)
    // A phone number is never required of a member, so this number is real and the committee has
    // to decide how the rest are told.
    expect(preview.withoutPhone).toBeGreaterThan(0)
    expect(preview.delivers).toBe(false)
  })
})

describe('fifty members, fifty messages, no duplicates', () => {
  it('logs one message per member and sends none of them twice', async () => {
    const list = await createMembersWithPhones(50, 200)
    expect(list).toHaveLength(50)

    const created = await draft({
      audience: 'ALL_MEMBERS',
      body: 'Inteko rusange ni ku wa gatandatu.',
    })
    const first = (
      await sending(secretary, 'post', `/announcements/${created.id}/publish`)
        .send({ sendSms: true })
        .expect(200)
    ).body.data as { sms: SendResult }

    // Fifty members were created here; earlier tests in this file added a few more, so the count
    // is read from the log rather than assumed.
    const logged = await prisma.smsMessage.count({
      where: { cooperativeId: cooperative.id, announcementId: created.id },
    })
    expect(logged).toBe(first.sms.sent + first.sms.failed)
    expect(first.sms.sent).toBeGreaterThanOrEqual(50)
    expect(first.sms.delivered).toBe(false)

    // Publishing the same announcement again sends nothing: the dedupe key names the announcement
    // and the member, and the database refuses the second row.
    const second = (
      await sending(secretary, 'post', `/announcements/${created.id}/publish`)
        .send({ sendSms: true })
        .expect(200)
    ).body.data as { sms: SendResult }

    expect(second.sms.sent).toBe(0)
    expect(second.sms.alreadySent).toBe(first.sms.sent + first.sms.failed)

    const afterSecond = await prisma.smsMessage.count({
      where: { cooperativeId: cooperative.id, announcementId: created.id },
    })
    expect(afterSecond).toBe(logged)
  }, 120_000)

  it('writes no row at all for a member with no telephone', async () => {
    const created = await draft({ audience: 'ALL_MEMBERS' })
    await sending(secretary, 'post', `/announcements/${created.id}/publish`)
      .send({ sendSms: true })
      .expect(200)

    const rows = await prisma.smsMessage.findMany({
      where: { cooperativeId: cooperative.id, announcementId: created.id },
      select: { toPhone: true },
    })
    // Every row has a number, because a member without one is reported as unreachable rather than
    // logged as a failure. A log full of failures for people who never had a number would bury the
    // one failure that matters.
    expect(rows.every((row) => row.toPhone.startsWith('+2507'))).toBe(true)
  })

  it('records a refusal with the reason a person can act on', async () => {
    // The mock refuses a number ending 000000, so a cooperative's staff can see what a partial
    // send looks like — forty-nine delivered and one not.
    const failing = await as(manager, 'post', '/members')
      .send({ firstName: 'Utagerwaho', lastName: 'Numero', phone: '0781000000' })
      .expect(201)

    const created = await draft({ audience: 'ALL_MEMBERS' })
    await sending(secretary, 'post', `/announcements/${created.id}/publish`)
      .send({ sendSms: true })
      .expect(200)

    const row = await prisma.smsMessage.findFirst({
      where: {
        cooperativeId: cooperative.id,
        announcementId: created.id,
        memberId: failing.body.data.id as string,
      },
      select: { status: true, failureReason: true, sentAt: true },
    })
    expect(row?.status).toBe('FAILED')
    expect(row?.failureReason).toBe('The number is not in service.')
    expect(row?.sentAt).toBeNull()
  })
})

describe('what members actually receive', () => {
  it('sends the Kinyarwanda text where the cooperative wrote one', async () => {
    const created = await draft({
      audience: 'ALL_MEMBERS',
      body: 'The assembly has moved to Saturday.',
      bodyRw: 'Inteko rusange yimuriwe ku wa gatandatu.',
    })
    await sending(secretary, 'post', `/announcements/${created.id}/publish`)
      .send({ sendSms: true })
      .expect(200)

    const row = await prisma.smsMessage.findFirst({
      where: { cooperativeId: cooperative.id, announcementId: created.id },
      select: { body: true },
    })
    // A member reading an SMS is not choosing a language in an interface. The cooperative wrote
    // for them in Kinyarwanda, so that is what is sent.
    expect(row?.body).toBe('Inteko rusange yimuriwe ku wa gatandatu.')
  })
})

describe('archiving', () => {
  it('keeps a published announcement in the record with the reason', async () => {
    const created = await draft()
    await sending(secretary, 'post', `/announcements/${created.id}/publish`)
      .send({ sendSms: false })
      .expect(200)

    const archived = (
      await as(secretary, 'post', `/announcements/${created.id}/archive`)
        .send({ reason: 'The date changed again' })
        .expect(200)
    ).body.data as Announcement

    expect(archived.status).toBe('ARCHIVED')
    expect(archived.archiveReason).toBe('The date changed again')
    // Still there, and still readable. Nothing is deleted.
    await as(secretary, 'get', `/announcements/${created.id}`).expect(200)
  })

  it('refuses to archive without a reason', async () => {
    const created = await draft()
    await as(secretary, 'post', `/announcements/${created.id}/archive`).send({}).expect(422)
  })

  it('archives an abandoned draft without inventing a publisher', async () => {
    const created = await draft()
    const archived = (
      await as(secretary, 'post', `/announcements/${created.id}/archive`)
        .send({ reason: 'Not needed after all' })
        .expect(200)
    ).body.data as Announcement

    expect(archived.status).toBe('ARCHIVED')
    // A draft was never published, so recording somebody as its publisher would put something in
    // the record that never happened.
    expect(archived.publishedBy).toBeNull()
    expect(archived.publishedAt).toBeNull()
  })

  it('will not publish an archived announcement', async () => {
    const created = await draft()
    await as(secretary, 'post', `/announcements/${created.id}/archive`)
      .send({ reason: 'Withdrawn' })
      .expect(200)
    const refused = await sending(secretary, 'post', `/announcements/${created.id}/publish`)
      .send({ sendSms: false })
      .expect(409)
    expect(refused.body.error.messageKey).toBe('errors.announcements.archived')
  })
})

describe('the message log', () => {
  it('is readable only by somebody who may send', async () => {
    // It holds the body of every message, which can name a member and an amount they owe.
    await as(accountant, 'get', '/sms/messages').expect(403)
    await as(secretary, 'get', '/sms/messages').expect(200)
  })

  it('shows nothing of another cooperative', async () => {
    const mine = (await as(secretary, 'get', '/sms/messages?pageSize=100').expect(200)).body
      .meta as { total: number }
    expect(mine.total).toBeGreaterThan(0)

    const theirs = (await as(otherManager, 'get', '/sms/messages', other).expect(200)).body
      .meta as {
      total: number
    }
    expect(theirs.total).toBe(0)
  })

  it('names the member and the announcement behind each message', async () => {
    const page = (await as(secretary, 'get', '/sms/messages?pageSize=5').expect(200)).body.data as {
      memberName: string | null
      announcementTitle: string | null
      provider: string
    }[]
    expect(page.length).toBeGreaterThan(0)
    expect(page[0]?.memberName).toBeTruthy()
    expect(page[0]?.provider).toBe('mock')
  })
})

describe('an ad-hoc message', () => {
  it('refuses to send without an idempotency key, because a text cannot be taken back', async () => {
    const members = await createMembersWithPhones(1, 900)
    const refused = await as(secretary, 'post', '/sms/send')
      .send({ memberIds: members, body: 'A reminder about Saturday.' })
      .expect(422)
    expect(refused.body.error.details?.[0]?.field).toBe('headers.Idempotency-Key')
  })

  it('sends once when the same key is presented twice', async () => {
    const members = await createMembersWithPhones(1, 910)
    const key = randomUUID()
    const body = { memberIds: members, body: 'A reminder about Saturday.' }

    const first = await as(secretary, 'post', '/sms/send')
      .set(HEADERS.idempotencyKey, key)
      .send(body)
      .expect(200)
    const second = await as(secretary, 'post', '/sms/send')
      .set(HEADERS.idempotencyKey, key)
      .send(body)
      .expect(200)

    expect((first.body.data as SendResult).sent).toBe(1)
    // The same answer, not a second send and not a confusing "0 sent, 1 already sent".
    expect(second.body.data).toEqual(first.body.data)

    const logged = await prisma.smsMessage.count({
      where: { cooperativeId: cooperative.id, dedupeKey: { startsWith: `manual:${key}` } },
    })
    expect(logged).toBe(1)
  })
})
