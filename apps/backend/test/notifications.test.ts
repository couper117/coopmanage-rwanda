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
 * Phase 12 — the notification centre.
 *
 * Notifications are written by whichever module noticed something, since Phase 6, and this is
 * where they are read. Four things this file holds in place:
 *
 * **Nothing is raised twice.** The dedupe key is unique per cooperative, so a watch that runs
 * after every movement cannot pile up forty copies of one warning.
 *
 * **A personal notification is private.** A row addressed to one member of staff is invisible to
 * every other, which in a cooperative matters as much as the record behind it.
 *
 * **A shared notification read by anybody is read.** Deliberate, and the opposite choice would be
 * defensible — so it is tested, which is how a deliberate decision is told apart from an accident.
 *
 * **Dismissing is not deleting.** The row leaves the list and stays in the table, because "were we
 * warned about this?" is asked after the fertiliser has run out.
 */

let cooperative: TestCooperative
let manager: TestUser & Session & { staffId: string }
let storekeeper: TestUser & Session & { staffId: string }

let other: TestCooperative
let otherManager: TestUser & Session & { staffId: string }

function as(
  session: Session,
  method: 'get' | 'post',
  path: string,
  coop: TestCooperative = cooperative,
) {
  return request(app)
    [method](`${API_PREFIX}${path}`)
    .set('Authorization', `Bearer ${session.accessToken}`)
    .set(HEADERS.cooperativeId, coop.id)
}

interface Notification {
  id: string
  type: string
  severity: string
  messageKey: string
  actionUrl: string | null
  personal: boolean
  readAt: string | null
}

interface Summary {
  unread: number
  unreadByType: Record<string, number>
  latest: Notification[]
}

/**
 * Notifications come from modules, not from an endpoint, so a test writes them the way a module
 * does. The dedupe key is part of the row's identity, exactly as in production.
 */
async function raise(input: {
  coop?: TestCooperative
  userId?: string | null
  type?: 'LOW_STOCK' | 'REPORT_READY' | 'SYSTEM' | 'MEETING_REMINDER'
  severity?: 'INFO' | 'WARNING' | 'CRITICAL'
  dedupeKey: string
  actionUrl?: string | null
}): Promise<string> {
  const row = await prisma.notification.create({
    data: {
      cooperativeId: (input.coop ?? cooperative).id,
      userId: input.userId ?? null,
      type: input.type ?? 'SYSTEM',
      severity: input.severity ?? 'INFO',
      messageKey: `notifications.${(input.type ?? 'SYSTEM').toLowerCase()}.test`,
      messageParams: { product: 'Ifumbire NPK' },
      dedupeKey: input.dedupeKey,
      actionUrl: input.actionUrl ?? null,
    },
    select: { id: true },
  })
  return row.id
}

beforeAll(async () => {
  cooperative = await createCooperative('Notifications Test Cooperative')
  manager = await createStaffSession(app, cooperative, 'MANAGER')
  storekeeper = await createStaffSession(app, cooperative, 'INVENTORY_OFFICER')

  other = await createCooperative('Other Notifications Cooperative')
  otherManager = await createStaffSession(app, other, 'MANAGER')
}, 60_000)

afterAll(async () => {
  await cleanupFixtures()
  await disconnectPrisma()
})

describe('what the bell shows', () => {
  it('counts what is waiting, by category, and carries the newest few', async () => {
    await raise({ dedupeKey: 'bell:one', type: 'LOW_STOCK', severity: 'WARNING' })
    await raise({ dedupeKey: 'bell:two', type: 'LOW_STOCK', severity: 'CRITICAL' })
    await raise({ dedupeKey: 'bell:three', type: 'REPORT_READY' })

    const summary = (await as(manager, 'get', '/notifications/summary').expect(200)).body
      .data as Summary

    expect(summary.unread).toBeGreaterThanOrEqual(3)
    expect(summary.unreadByType.LOW_STOCK).toBeGreaterThanOrEqual(2)
    expect(summary.latest.length).toBeGreaterThan(0)
    // Worst first: a critical warning matters more than an information notice raised later.
    expect(summary.latest[0]?.severity).toBe('CRITICAL')
  })

  it('is one small request rather than the whole list', async () => {
    const summary = (await as(manager, 'get', '/notifications/summary').expect(200)).body
      .data as Summary
    // The bell is on every screen and asks repeatedly, so it is given five rows and the counts.
    expect(summary.latest.length).toBeLessThanOrEqual(5)
  })
})

describe('who can see what', () => {
  it('shows a cooperative-wide notification to everybody who works there', async () => {
    await raise({ dedupeKey: 'shared:stock', type: 'LOW_STOCK', severity: 'WARNING' })

    for (const session of [manager, storekeeper]) {
      const rows = (await as(session, 'get', '/notifications?pageSize=100').expect(200)).body
        .data as Notification[]
      expect(rows.some((row) => row.messageKey === 'notifications.low_stock.test')).toBe(true)
    }
  })

  it('keeps a personal notification to the person it was addressed to', async () => {
    const id = await raise({
      dedupeKey: 'personal:manager',
      userId: manager.id,
      type: 'REPORT_READY',
    })

    const mine = (await as(manager, 'get', '/notifications?pageSize=100').expect(200)).body
      .data as Notification[]
    expect(mine.find((row) => row.id === id)?.personal).toBe(true)

    const theirs = (await as(storekeeper, 'get', '/notifications?pageSize=100').expect(200)).body
      .data as Notification[]
    // Not merely absent from the list: unreachable. A storekeeper cannot read the manager's row
    // even by asking for it directly.
    expect(theirs.some((row) => row.id === id)).toBe(false)
    await as(storekeeper, 'post', `/notifications/${id}/read`).expect(404)
  })

  it('shows nothing of another cooperative', async () => {
    const theirs = await raise({ coop: other, dedupeKey: 'theirs:stock', type: 'LOW_STOCK' })

    const mine = (await as(manager, 'get', '/notifications?pageSize=100').expect(200)).body
      .data as Notification[]
    expect(mine.some((row) => row.id === theirs)).toBe(false)
    // 404, not 403: another cooperative's notification should not confirm that it exists.
    await as(manager, 'post', `/notifications/${theirs}/read`).expect(404)

    // And the other cooperative can read its own, so this is not passing because the row is
    // unreachable to everybody.
    const forThem = (
      await as(otherManager, 'get', '/notifications?pageSize=100', other).expect(200)
    ).body.data as Notification[]
    expect(forThem.some((row) => row.id === theirs)).toBe(true)
  })
})

describe('reading', () => {
  it('marks one read, and reading it again does not move when it was first seen', async () => {
    const id = await raise({ dedupeKey: 'read:once', type: 'SYSTEM' })

    const first = (await as(manager, 'post', `/notifications/${id}/read`).expect(200)).body
      .data as Notification
    expect(first.readAt).not.toBeNull()

    const second = (await as(manager, 'post', `/notifications/${id}/read`).expect(200)).body
      .data as Notification
    // The interface marks a notification read the moment it is opened, so a second open must not
    // rewrite the time it was first seen.
    expect(second.readAt).toBe(first.readAt)
  })

  it('marks a shared notification read for everybody, which is the point of sharing it', async () => {
    const id = await raise({ dedupeKey: 'shared:read', type: 'LOW_STOCK', severity: 'WARNING' })
    await as(storekeeper, 'post', `/notifications/${id}/read`).expect(200)

    const forTheManager = (await as(manager, 'get', '/notifications?pageSize=100').expect(200)).body
      .data as Notification[]
    // One warning is one piece of work. Keeping it bold for the manager and the accountant after
    // the storekeeper has dealt with it is noise, and noise is how an alert stops being read.
    expect(forTheManager.find((row) => row.id === id)?.readAt).not.toBeNull()
  })

  it('clears the bell in one action', async () => {
    await raise({ dedupeKey: 'clear:one' })
    await raise({ dedupeKey: 'clear:two' })

    const result = (await as(manager, 'post', '/notifications/read-all').expect(200)).body.data as {
      marked: number
    }
    expect(result.marked).toBeGreaterThan(0)

    const summary = (await as(manager, 'get', '/notifications/summary').expect(200)).body
      .data as Summary
    expect(summary.unread).toBe(0)
  })
})

describe('dismissing', () => {
  it('takes it out of the list and leaves it in the record', async () => {
    const id = await raise({ dedupeKey: 'dismiss:one', type: 'LOW_STOCK' })
    await as(manager, 'post', `/notifications/${id}/dismiss`).expect(200)

    const visible = (await as(manager, 'get', '/notifications?pageSize=100').expect(200)).body
      .data as Notification[]
    expect(visible.some((row) => row.id === id)).toBe(false)

    // Still answerable: "were we warned about this?" is asked after the event.
    const dismissed = (
      await as(manager, 'get', '/notifications?dismissed=only&pageSize=100').expect(200)
    ).body.data as Notification[]
    expect(dismissed.some((row) => row.id === id)).toBe(true)

    const row = await prisma.notification.findUnique({
      where: { id },
      select: { dismissedAt: true, readAt: true },
    })
    expect(row?.dismissedAt).not.toBeNull()
    // Dismissing marks it read too: something somebody decided not to act on has certainly been
    // seen, and leaving it unread would keep it in the bell's count for ever.
    expect(row?.readAt).not.toBeNull()
  })
})

describe('the same warning twice', () => {
  it('cannot be raised, because the database refuses it', async () => {
    await raise({ dedupeKey: 'dedupe:same', type: 'LOW_STOCK' })
    // The watch runs after every movement. Without this it would pile up a copy each time, and a
    // list of forty identical warnings is a list nobody reads.
    await expect(raise({ dedupeKey: 'dedupe:same', type: 'LOW_STOCK' })).rejects.toThrow()
  })

  it('is scoped per cooperative, so two cooperatives can each have their own', async () => {
    await raise({ dedupeKey: 'dedupe:per-tenant', type: 'LOW_STOCK' })
    // The same product key at another cooperative is a different warning about a different store.
    await expect(
      raise({ coop: other, dedupeKey: 'dedupe:per-tenant', type: 'LOW_STOCK' }),
    ).resolves.toBeTruthy()
  })
})

describe('filtering', () => {
  it('narrows by category, by severity and to the unread', async () => {
    await raise({ dedupeKey: 'filter:critical', type: 'LOW_STOCK', severity: 'CRITICAL' })
    await raise({ dedupeKey: 'filter:info', type: 'REPORT_READY', severity: 'INFO' })

    const critical = (
      await as(manager, 'get', '/notifications?severity=CRITICAL&pageSize=100').expect(200)
    ).body.data as Notification[]
    expect(critical.length).toBeGreaterThan(0)
    expect(critical.every((row) => row.severity === 'CRITICAL')).toBe(true)

    const reports = (
      await as(manager, 'get', '/notifications?type=REPORT_READY&pageSize=100').expect(200)
    ).body.data as Notification[]
    expect(reports.every((row) => row.type === 'REPORT_READY')).toBe(true)

    const unread = (
      await as(manager, 'get', '/notifications?unreadOnly=true&pageSize=100').expect(200)
    ).body.data as Notification[]
    expect(unread.every((row) => row.readAt === null)).toBe(true)
  })

  it('refuses a filter it does not know rather than ignoring it', async () => {
    await as(manager, 'get', '/notifications?category=LOW_STOCK').expect(422)
  })
})
