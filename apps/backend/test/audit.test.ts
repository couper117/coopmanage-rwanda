import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { API_PREFIX } from '../src/app.js'
import { testApp } from './server.js'
import { redactSnapshot } from '../src/lib/audit.js'
import { disconnectPrisma, prisma } from '../src/lib/prisma.js'
import { registeredRoutes } from '../src/lib/routeRegistry.js'
import '../src/routes.js'
import {
  cleanupFixtures,
  createCooperative,
  createStaffSession,
  TEST_PASSWORD,
  type TestCooperative,
} from './fixtures.js'

const app = testApp()
let cooperative: TestCooperative

beforeAll(async () => {
  cooperative = await createCooperative()
})

afterAll(async () => {
  await cleanupFixtures()
  await disconnectPrisma()
})

describe('append-only enforcement', () => {
  it('refuses an UPDATE to an audit row', async () => {
    const row = await prisma.auditLog.create({
      data: {
        cooperativeId: cooperative.id,
        actorLabel: 'append-only check',
        action: 'member.created',
        entityType: 'Member',
        messageKey: 'audit.member.created',
      },
      select: { id: true },
    })

    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'member.deleted' } }),
    ).rejects.toThrow(/append only/i)
  })

  it('refuses a DELETE of an audit row', async () => {
    const row = await prisma.auditLog.create({
      data: {
        cooperativeId: cooperative.id,
        actorLabel: 'append-only check',
        action: 'member.created',
        entityType: 'Member',
        messageKey: 'audit.member.created',
      },
      select: { id: true },
    })

    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append only/i)
  })

  it('exposes no write route at all', () => {
    // The application reads the trail and nothing more. The database enforces this as well, but a
    // write route would turn that from a design property into an exception somebody has to catch.
    const writeRoutes = registeredRoutes().filter(
      (route) => route.path.startsWith('/audit') && route.method !== 'GET',
    )
    expect(writeRoutes.map((route) => `${route.method} ${route.path}`)).toEqual([])
  })
})

describe('redaction', () => {
  it('removes a secret wherever it appears in a snapshot', () => {
    const snapshot = redactSnapshot({
      fullName: 'Uwase Divine',
      passwordHash: '$argon2id$v=19$m=19456,t=3,p=1$abc',
      nested: { token: 'abc123', keep: 'visible' },
    })

    expect(JSON.stringify(snapshot)).not.toContain('$argon2')
    expect(JSON.stringify(snapshot)).not.toContain('abc123')
    expect((snapshot as { nested: { keep: string } }).nested.keep).toBe('visible')
  })

  it('records a cleared field as null rather than dropping it', () => {
    const snapshot = redactSnapshot({ phone: null })
    expect(snapshot).toHaveProperty('phone', null)
  })

  it('keeps a password out of the trail when one is changed', async () => {
    const staff = await createStaffSession(app, cooperative, 'MANAGER')
    await request(app)
      .post(`${API_PREFIX}/auth/change-password`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'an-entirely-new-passphrase' })
      .expect(204)

    const entry = await prisma.auditLog.findFirst({
      where: { actorUserId: staff.id, action: 'user.password.changed' },
    })
    expect(entry).not.toBeNull()
    expect(JSON.stringify(entry)).not.toContain('an-entirely-new-passphrase')
    expect(JSON.stringify(entry)).not.toContain('$argon2')
  })
})

describe('reading the trail', () => {
  it('records a failed login without a session existing', async () => {
    const staff = await createStaffSession(app, cooperative, 'MANAGER')
    await request(app)
      .post(`${API_PREFIX}/auth/login`)
      .send({ email: staff.email, password: 'definitely-the-wrong-one' })
      .expect(401)

    const entry = await prisma.auditLog.findFirst({
      where: { actorUserId: staff.id, action: 'auth.login.failed' },
      select: { actorLabel: true, cooperativeId: true },
    })
    expect(entry?.actorLabel).toContain(staff.email)
    // A login belongs to no cooperative: it happens before one is chosen.
    expect(entry?.cooperativeId).toBeNull()
  })

  it('pages newest first with a cursor', async () => {
    const manager = await createStaffSession(app, cooperative, 'MANAGER')

    for (let index = 0; index < 5; index += 1) {
      await prisma.auditLog.create({
        data: {
          cooperativeId: cooperative.id,
          actorLabel: 'paging check',
          action: `member.created`,
          entityType: 'Member',
          entityId: `row-${index}`,
          messageKey: 'audit.member.created',
        },
      })
    }

    const first = await request(app)
      .get(`${API_PREFIX}/audit?limit=2&entityType=Member`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set('X-Cooperative-Id', cooperative.id)
      .expect(200)

    expect(first.body.data).toHaveLength(2)
    expect(first.body.meta.nextCursor).toBeTypeOf('string')

    const second = await request(app)
      .get(
        `${API_PREFIX}/audit?limit=2&entityType=Member&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`,
      )
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set('X-Cooperative-Id', cooperative.id)
      .expect(200)

    const firstIds = first.body.data.map((row: { id: string }) => row.id)
    const secondIds = second.body.data.map((row: { id: string }) => row.id)
    expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false)

    const timestamps = [...first.body.data, ...second.body.data].map(
      (row: { createdAt: string }) => row.createdAt,
    )
    expect([...timestamps].sort().reverse()).toEqual(timestamps)
  })

  it('reports no further page once the entries run out', async () => {
    const manager = await createStaffSession(app, cooperative, 'MANAGER')
    const res = await request(app)
      .get(`${API_PREFIX}/audit?limit=100&action=nothing.matches.this`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set('X-Cooperative-Id', cooperative.id)
      .expect(200)

    expect(res.body.data).toEqual([])
    expect(res.body.meta.nextCursor).toBeNull()
  })

  it('rejects an unknown filter rather than ignoring it', async () => {
    const manager = await createStaffSession(app, cooperative, 'MANAGER')
    const res = await request(app)
      .get(`${API_PREFIX}/audit?entitytype=Member`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set('X-Cooperative-Id', cooperative.id)
      .expect(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })

  it('never returns the before and after snapshots to the list', async () => {
    const manager = await createStaffSession(app, cooperative, 'MANAGER')
    const res = await request(app)
      .get(`${API_PREFIX}/audit?limit=5`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set('X-Cooperative-Id', cooperative.id)
      .expect(200)

    for (const row of res.body.data) {
      expect(row).not.toHaveProperty('before')
      expect(row).not.toHaveProperty('after')
      expect(row).not.toHaveProperty('ipAddress')
    }
  })
})
