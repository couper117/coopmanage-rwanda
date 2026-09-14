import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HEADERS } from '@coopmanage/shared'
import { API_PREFIX } from '../src/app.js'
import { testApp } from './server.js'
import { disconnectPrisma, prisma } from '../src/lib/prisma.js'
import {
  cleanupFixtures,
  createCooperative,
  createStaffSession,
  createUser,
  login,
  testEmail,
  type Session,
  type TestCooperative,
  type TestUser,
} from './fixtures.js'

const app = testApp()

let admin: TestUser & Session
let secondAdmin: TestUser & Session
let ordinary: TestUser & Session
let cooperative: TestCooperative

/** Tracks what these tests create outside the fixture helpers, so teardown stays honest. */
const createdCooperativeCodes: string[] = []
const createdUserEmails: string[] = []

function asAdmin(method: 'get' | 'post' | 'patch' | 'put', path: string, session = admin) {
  return request(app)
    [method](`${API_PREFIX}${path}`)
    .set('Authorization', `Bearer ${session.accessToken}`)
}

beforeAll(async () => {
  const adminUser = await createUser({ isPlatformAdmin: true, fullName: 'Nkusi Platform' })
  admin = { ...adminUser, ...(await login(app, adminUser)) }
  const secondUser = await createUser({ isPlatformAdmin: true, fullName: 'Uwera Platform' })
  secondAdmin = { ...secondUser, ...(await login(app, secondUser)) }

  cooperative = await createCooperative('Admin Fixture Cooperative')
  const staff = await createStaffSession(app, cooperative, 'MANAGER')
  ordinary = staff
}, 60_000)

afterAll(async () => {
  // Rows created through the API, which the fixture tracker never saw.
  if (createdCooperativeCodes.length > 0) {
    const coops = await prisma.cooperative.findMany({
      where: { code: { in: createdCooperativeCodes } },
      select: { id: true },
    })
    const ids = coops.map((row) => row.id)
    await prisma.cooperativeStaff.deleteMany({ where: { cooperativeId: { in: ids } } })
    await prisma.$executeRawUnsafe('ALTER TABLE audit_log DISABLE TRIGGER USER')
    try {
      await prisma.auditLog.deleteMany({ where: { cooperativeId: { in: ids } } })
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE audit_log ENABLE TRIGGER USER')
    }
    await prisma.cooperative.deleteMany({ where: { id: { in: ids } } })
  }
  if (createdUserEmails.length > 0) {
    const users = await prisma.user.findMany({
      where: { email: { in: createdUserEmails } },
      select: { id: true },
    })
    const ids = users.map((row) => row.id)
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: ids } } })
    await prisma.refreshSession.deleteMany({ where: { userId: { in: ids } } })
    await prisma.cooperativeStaff.deleteMany({ where: { userId: { in: ids } } })
    await prisma.$executeRawUnsafe('ALTER TABLE audit_log DISABLE TRIGGER USER')
    try {
      await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } })
      await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } })
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE audit_log ENABLE TRIGGER USER')
    }
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
  }
  await cleanupFixtures()
  await disconnectPrisma()
})

describe('reaching the platform surface', () => {
  it('is invisible to an ordinary cooperative manager', async () => {
    // 404, not 403: a user who is not a platform administrator should not learn that /admin exists.
    const response = await asAdmin('get', '/admin/cooperatives', ordinary)
    expect(response.status).toBe(404)
  })

  it('is unreachable without a session at all', async () => {
    await request(app).get(`${API_PREFIX}/admin/cooperatives`).expect(401)
  })

  it('ignores a cooperative header, because these endpoints carry no tenant', async () => {
    await request(app)
      .get(`${API_PREFIX}/admin/cooperatives`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set(HEADERS.cooperativeId, cooperative.id)
      .expect(200)
  })
})

describe('cooperatives', () => {
  it('lists every cooperative with staff counts and pagination metadata', async () => {
    const response = await asAdmin('get', '/admin/cooperatives?pageSize=5').expect(200)
    expect(response.body.meta.pageSize).toBe(5)
    expect(response.body.meta.total).toBeGreaterThan(0)
    expect(response.body.data.length).toBeLessThanOrEqual(5)
    expect(response.body.data[0]).toHaveProperty('activeStaffCount')
  })

  it('searches by name, code and district', async () => {
    const response = await asAdmin('get', '/admin/cooperatives?q=Admin%20Fixture').expect(200)
    expect(
      response.body.data.some((row: { name: string }) => row.name.includes('Admin Fixture')),
    ).toBe(true)
  })

  it('refuses an unknown query parameter rather than ignoring it', async () => {
    await asAdmin('get', '/admin/cooperatives?sortBy=name').expect(422)
  })

  it('creates a cooperative and its first manager together', async () => {
    const code = `NEW-${randomUUID().slice(0, 6)}`.toUpperCase()
    const email = testEmail('manager')
    createdCooperativeCodes.push(code)
    createdUserEmails.push(email)

    const response = await asAdmin('post', '/admin/cooperatives')
      .send({
        name: 'Koperative Nshya',
        code,
        typeKey: 'DAIRY',
        province: 'NORTHERN',
        district: 'Musanze',
        sector: 'Muhoza',
        cell: 'Cyabararika',
        village: 'Nyabisindu',
        manager: { email, fullName: 'Bizimana Joseph' },
      })
      .expect(201)

    expect(response.body.data.cooperative.code).toBe(code)
    expect(response.body.data.manager.accountCreated).toBe(true)

    const staff = await prisma.cooperativeStaff.findFirstOrThrow({
      where: { cooperative: { code } },
      select: { role: { select: { key: true } }, status: true },
    })
    expect(staff.role.key).toBe('MANAGER')
    expect(staff.status).toBe('ACTIVE')
  })

  it('makes the new manager able to sign in only after setting a password', async () => {
    const code = `PWD-${randomUUID().slice(0, 6)}`.toUpperCase()
    const email = testEmail('pwd')
    createdCooperativeCodes.push(code)
    createdUserEmails.push(email)

    await asAdmin('post', '/admin/cooperatives')
      .send({
        name: 'Password Flow Cooperative',
        code,
        typeKey: 'COFFEE',
        province: 'WESTERN',
        district: 'Karongi',
        sector: 'Bwishyura',
        cell: 'Gitarama',
        village: 'Kiniha',
        manager: { email, fullName: 'Nyirahabimana Alice' },
      })
      .expect(201)

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true, mustChangePassword: true },
    })
    expect(user.mustChangePassword).toBe(true)

    const tokens = await prisma.passwordResetToken.count({
      where: { userId: user.id, usedAt: null },
    })
    expect(tokens).toBe(1)
  })

  it('rolls back entirely when the code is already taken', async () => {
    const existing = await prisma.cooperative.findFirstOrThrow({ select: { code: true } })
    const email = testEmail('rollback')

    const response = await asAdmin('post', '/admin/cooperatives')
      .send({
        name: 'Duplicate Code Cooperative',
        code: existing.code,
        typeKey: 'TRADING',
        province: 'EASTERN',
        district: 'Kayonza',
        sector: 'Mukarange',
        cell: 'Nyagatovu',
        village: 'Kabare',
        manager: { email, fullName: 'Rollback Person' },
      })
      .expect(409)

    expect(response.body.error.code).toBe('DUPLICATE_RESOURCE')
    // The manager account must not survive a cooperative that was never created.
    const orphan = await prisma.user.findUnique({ where: { email } })
    expect(orphan).toBeNull()
  })

  it('refuses an unknown cooperative type', async () => {
    await asAdmin('post', '/admin/cooperatives')
      .send({
        name: 'Bad Type Cooperative',
        code: `BAD-${randomUUID().slice(0, 6)}`.toUpperCase(),
        typeKey: 'SPACE_MINING',
        province: 'KIGALI',
        district: 'Gasabo',
        sector: 'Remera',
        cell: 'Rukiri',
        village: 'Amahoro',
        manager: { email: testEmail('bad'), fullName: 'Bad Type' },
      })
      .expect(422)
  })

  it('suspends a cooperative and signs its staff out immediately', async () => {
    const target = await createCooperative('To Be Suspended')
    const staff = await createStaffSession(app, target, 'MANAGER')

    await request(app)
      .get(`${API_PREFIX}/cooperatives/current`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .set(HEADERS.cooperativeId, target.id)
      .expect(200)

    await asAdmin('patch', `/admin/cooperatives/${target.id}`)
      .send({ status: 'SUSPENDED', reason: 'Unpaid subscription' })
      .expect(200)

    const live = await prisma.refreshSession.count({
      where: { userId: staff.id, revokedAt: null },
    })
    expect(live).toBe(0)
  })

  it('refuses to archive a cooperative that still has active staff', async () => {
    const target = await createCooperative('Still Staffed')
    await createStaffSession(app, target, 'MANAGER')

    const response = await asAdmin('patch', `/admin/cooperatives/${target.id}`)
      .send({ status: 'ARCHIVED' })
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.admin.archiveHasStaff')
  })

  it('answers 404 for a cooperative that does not exist', async () => {
    await asAdmin('patch', `/admin/cooperatives/${randomUUID()}`)
      .send({ status: 'SUSPENDED' })
      .expect(404)
  })

  it('records every cooperative change in the audit trail', async () => {
    const target = await createCooperative('Audited Cooperative')
    await asAdmin('patch', `/admin/cooperatives/${target.id}`)
      .send({ name: 'Audited Cooperative Renamed' })
      .expect(200)

    const entry = await prisma.auditLog.findFirst({
      where: { entityId: target.id, action: 'platform.cooperative.updated' },
      orderBy: { createdAt: 'desc' },
    })
    expect(entry?.actorLabel).toContain(admin.email)
    expect(entry?.after).toMatchObject({ name: 'Audited Cooperative Renamed' })
  })
})

describe('users', () => {
  it('lists users with their memberships', async () => {
    const response = await asAdmin(
      'get',
      `/admin/users?q=${encodeURIComponent(ordinary.email)}`,
    ).expect(200)
    const row = response.body.data[0]
    expect(row.email).toBe(ordinary.email)
    expect(row.memberships[0].cooperativeName).toBe('Admin Fixture Cooperative')
  })

  it('never returns a password hash', async () => {
    const response = await asAdmin('get', '/admin/users?pageSize=20').expect(200)
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|\$argon2/)
  })

  it('creates a user with an unusable password and a reset token', async () => {
    const email = testEmail('created')
    createdUserEmails.push(email)

    const response = await asAdmin('post', '/admin/users')
      .send({ email, fullName: 'Mutoni Grace' })
      .expect(201)

    expect(response.body.data.mustChangePassword).toBe(true)
    expect(response.body.data.isPlatformAdmin).toBe(false)
  })

  it('refuses an email that already exists', async () => {
    const response = await asAdmin('post', '/admin/users')
      .send({ email: ordinary.email, fullName: 'Duplicate' })
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.admin.emailTaken')
  })

  it('suspends a user and ends their sessions at once', async () => {
    const victim = await createUser()
    const session = await login(app, victim)

    await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200)

    await asAdmin('patch', `/admin/users/${victim.id}`)
      .send({ status: 'SUSPENDED', reason: 'Left the organisation' })
      .expect(200)

    await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(401)
  })

  it('refuses to let an administrator change their own access', async () => {
    const suspendSelf = await asAdmin('patch', `/admin/users/${admin.id}`)
      .send({ status: 'SUSPENDED' })
      .expect(409)
    expect(suspendSelf.body.error.messageKey).toBe('errors.admin.notSelf')

    const demoteSelf = await asAdmin('patch', `/admin/users/${admin.id}`)
      .send({ isPlatformAdmin: false })
      .expect(409)
    expect(demoteSelf.body.error.messageKey).toBe('errors.admin.notSelf')
  })

  it('lets an administrator change their own display name, which grants nothing', async () => {
    await asAdmin('patch', `/admin/users/${admin.id}`)
      .send({ fullName: 'Nkusi Platform' })
      .expect(200)
  })

  it('lets one administrator demote another while a third remains', async () => {
    const spare = await createUser({ isPlatformAdmin: true })
    await asAdmin('patch', `/admin/users/${spare.id}`).send({ isPlatformAdmin: false }).expect(200)

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: spare.id },
      select: { isPlatformAdmin: true },
    })
    expect(row.isPlatformAdmin).toBe(false)
  })

  it('refuses to demote the last platform administrator', async () => {
    // Take the platform down to a single active administrator, then try to remove them.
    const solo = await createUser({ isPlatformAdmin: true })
    const soloSession = await login(app, solo)

    const others = await prisma.user.findMany({
      where: { isPlatformAdmin: true, status: 'ACTIVE', id: { not: solo.id } },
      select: { id: true },
    })
    await prisma.user.updateMany({
      where: { id: { in: others.map((row) => row.id) } },
      data: { isPlatformAdmin: false },
    })

    try {
      const response = await request(app)
        .patch(`${API_PREFIX}/admin/users/${solo.id}`)
        .set('Authorization', `Bearer ${soloSession.accessToken}`)
        .send({ isPlatformAdmin: false })
      // Refused as a self-change first, which is the stricter of the two guards.
      expect(response.status).toBe(409)
      expect(response.body.error.messageKey).toBe('errors.admin.notSelf')
    } finally {
      await prisma.user.updateMany({
        where: { id: { in: others.map((row) => row.id) } },
        data: { isPlatformAdmin: true },
      })
    }
  })
})

describe('platform settings', () => {
  it('returns defaults before anything is saved', async () => {
    const response = await asAdmin('get', '/admin/settings').expect(200)
    expect(['EN', 'RW']).toContain(response.body.data.defaultCooperativeLocale)
  })

  it('saves a setting and uses it when creating a cooperative', async () => {
    await asAdmin('put', '/admin/settings/defaultCooperativeLocale')
      .send({ value: 'EN' })
      .expect(200)

    const code = `LOC-${randomUUID().slice(0, 6)}`.toUpperCase()
    const email = testEmail('locale')
    createdCooperativeCodes.push(code)
    createdUserEmails.push(email)

    await asAdmin('post', '/admin/cooperatives')
      .send({
        name: 'Locale Default Cooperative',
        code,
        typeKey: 'SERVICES',
        province: 'KIGALI',
        district: 'Kicukiro',
        sector: 'Niboye',
        cell: 'Gatare',
        village: 'Ituze',
        manager: { email, fullName: 'Locale Person' },
      })
      .expect(201)

    const created = await prisma.cooperative.findFirstOrThrow({
      where: { code },
      select: { defaultLocale: true },
    })
    expect(created.defaultLocale).toBe('EN')

    // Put it back so the setting does not leak into other suites.
    await asAdmin('put', '/admin/settings/defaultCooperativeLocale')
      .send({ value: 'RW' })
      .expect(200)
  })

  it('refuses an unknown key and a value of the wrong shape', async () => {
    await asAdmin('put', '/admin/settings/nonsense').send({ value: 'x' }).expect(422)
    await asAdmin('put', '/admin/settings/defaultCooperativeLocale')
      .send({ value: 'FR' })
      .expect(422)
  })

  it('records who changed a platform setting', async () => {
    await asAdmin('put', '/admin/settings/defaultCooperativeLocale')
      .send({ value: 'RW' })
      .expect(200)
    const entry = await prisma.auditLog.findFirst({
      where: { action: 'platform.setting.updated' },
      orderBy: { createdAt: 'desc' },
    })
    expect(entry?.cooperativeId).toBeNull()
    expect(entry?.actorLabel).toContain(admin.email)
  })
})

describe('platform health', () => {
  it('reports the database and the platform counts', async () => {
    const response = await asAdmin('get', '/admin/health').expect(200)
    expect(response.body.data.database.reachable).toBe(true)
    expect(typeof response.body.data.database.latencyMs).toBe('number')
    expect(response.body.data.counts.cooperatives).toBeGreaterThan(0)
    expect(response.body.data.counts.platformAdmins).toBeGreaterThan(0)
  })

  it('is not reachable by an ordinary manager', async () => {
    await asAdmin('get', '/admin/health', ordinary).expect(404)
  })

  it('says more than the public probe, which is the point of it being authenticated', async () => {
    const publicProbe = await request(app).get(`${API_PREFIX}/health/ready`).expect(200)
    expect(publicProbe.body.data.checks.database).not.toHaveProperty('latencyMs')

    const authenticated = await asAdmin('get', '/admin/health').expect(200)
    expect(authenticated.body.data.database).toHaveProperty('latencyMs')
  })
})

describe('second administrator', () => {
  it('can act independently of the first', async () => {
    await asAdmin('get', '/admin/cooperatives', secondAdmin).expect(200)
  })
})
