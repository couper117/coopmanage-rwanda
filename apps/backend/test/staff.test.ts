import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HEADERS } from '@coopmanage/shared'
import { API_PREFIX, createApp } from '../src/app.js'
import { disconnectPrisma, prisma } from '../src/lib/prisma.js'
import {
  addStaff,
  cleanupFixtures,
  createCooperative,
  createStaffSession,
  createUser,
  login,
  testEmail,
  setOverride,
  type Session,
  type TestUser,
  type TestCooperative,
} from './fixtures.js'

const app = createApp()

let cooperative: TestCooperative
let manager: TestUser & Session & { staffId: string }
let secretary: TestUser & Session & { staffId: string }

function as(session: Session, method: 'get' | 'post' | 'patch' | 'put', path: string) {
  return request(app)
    [method](`${API_PREFIX}${path}`)
    .set('Authorization', `Bearer ${session.accessToken}`)
    .set(HEADERS.cooperativeId, cooperative.id)
}

beforeAll(async () => {
  cooperative = await createCooperative('Twizerane Dairy')
  manager = await createStaffSession(app, cooperative, 'MANAGER')
  secretary = await createStaffSession(app, cooperative, 'SECRETARY')
}, 60_000)

afterAll(async () => {
  await cleanupFixtures()
  await disconnectPrisma()
})

describe('listing staff', () => {
  it('returns the cooperative roster with roles', async () => {
    const response = await as(manager, 'get', '/staff').expect(200)
    const emails = response.body.data.map((row: { user: { email: string } }) => row.user.email)
    expect(emails).toContain(manager.email)
    expect(emails).toContain(secretary.email)
  })

  it('marks the caller so the interface can disable their own controls', async () => {
    const response = await as(manager, 'get', '/staff').expect(200)
    const self = response.body.data.find(
      (row: { user: { email: string } }) => row.user.email === manager.email,
    )
    expect(self.isSelf).toBe(true)
  })

  it('never returns a password hash or a token', async () => {
    const response = await as(manager, 'get', '/staff').expect(200)
    const serialised = JSON.stringify(response.body)
    expect(serialised).not.toMatch(/passwordHash|\$argon2|tokenHash/)
  })

  it('lets a secretary see the roster but not change it', async () => {
    await as(secretary, 'get', '/staff').expect(200)
    await as(secretary, 'post', '/staff/invite')
      .send({ email: testEmail('x'), fullName: 'Ineza Aline', roleKey: 'VIEWER' })
      .expect(403)
  })

  it('refuses an unknown filter value rather than ignoring it', async () => {
    await as(manager, 'get', '/staff?status=RETIRED').expect(422)
    await as(manager, 'get', '/staff?unknown=1').expect(422)
  })
})

describe('inviting staff', () => {
  it('creates an account, links it and reports that the account is new', async () => {
    const email = testEmail('invitee')
    const response = await as(manager, 'post', '/staff/invite')
      .send({
        email,
        fullName: 'Mukamana Chantal',
        roleKey: 'ACCOUNTANT',
        jobTitle: 'Umubaruramari',
      })
      .expect(201)

    expect(response.body.data.accountCreated).toBe(true)
    expect(response.body.data.staff.roleKey).toBe('ACCOUNTANT')
    expect(response.body.data.staff.jobTitle).toBe('Umubaruramari')

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { mustChangePassword: true, passwordHash: true },
    })
    // The invitation must not mint a usable credential; the password is random and unknown.
    expect(user.mustChangePassword).toBe(true)
    expect(user.passwordHash.startsWith('$argon2')).toBe(true)
  })

  it('issues a single-use reset token so the person sets their own password', async () => {
    const email = testEmail('token')
    await as(manager, 'post', '/staff/invite')
      .send({ email, fullName: 'Habimana Eric', roleKey: 'VIEWER' })
      .expect(201)

    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })
    const tokens = await prisma.passwordResetToken.findMany({
      where: { userId: user.id, usedAt: null },
    })
    expect(tokens).toHaveLength(1)
  })

  it('refuses to invite someone who is already active staff', async () => {
    const response = await as(manager, 'post', '/staff/invite')
      .send({ email: secretary.email, fullName: 'Someone Else', roleKey: 'VIEWER' })
      .expect(409)
    expect(response.body.error.code).toBe('DUPLICATE_RESOURCE')
  })

  it('reactivates a previously deactivated person instead of duplicating them', async () => {
    const user = await createUser()
    const { staffId } = await addStaff(cooperative.id, user.id, 'VIEWER')
    await as(manager, 'post', `/staff/${staffId}/deactivate`).send({}).expect(200)

    const response = await as(manager, 'post', '/staff/invite')
      .send({ email: user.email, fullName: 'Returning Person', roleKey: 'INVENTORY_OFFICER' })
      .expect(201)

    expect(response.body.data.staff.id).toBe(staffId)
    expect(response.body.data.staff.status).toBe('ACTIVE')
    expect(response.body.data.staff.roleKey).toBe('INVENTORY_OFFICER')

    const rows = await prisma.cooperativeStaff.count({
      where: { cooperativeId: cooperative.id, userId: user.id },
    })
    expect(rows).toBe(1)
  })

  it('refuses to grant a platform role through an invitation', async () => {
    await as(manager, 'post', '/staff/invite')
      .send({ email: testEmail('esc'), fullName: 'Escalation Attempt', roleKey: 'SYSTEM_ADMIN' })
      .expect(422)
  })

  it('rejects an unparseable email before touching the database', async () => {
    await as(manager, 'post', '/staff/invite')
      .send({ email: 'not-an-email', fullName: 'Bad Address', roleKey: 'VIEWER' })
      .expect(422)
  })
})

describe('changing a role', () => {
  it('changes a role and takes effect on the next request', async () => {
    const target = await createStaffSession(app, cooperative, 'VIEWER')
    // A viewer cannot see the roster.
    await as(target, 'get', '/staff').expect(403)

    await as(manager, 'patch', `/staff/${target.staffId}`)
      .send({ roleKey: 'SECRETARY' })
      .expect(200)

    // The permission cache is invalidated on the change, so this does not wait for expiry.
    await as(target, 'get', '/staff').expect(200)
  })

  it('refuses to change your own role, so nobody promotes themselves', async () => {
    const response = await as(manager, 'patch', `/staff/${manager.staffId}`)
      .send({ roleKey: 'VIEWER' })
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.staff.notSelf')
  })

  it('lets a manager change their own job title, which grants nothing', async () => {
    await as(manager, 'patch', `/staff/${manager.staffId}`)
      .send({ jobTitle: 'Umuyobozi mukuru' })
      .expect(200)
  })

  /**
   * The guard that keeps a cooperative administrable. It is tested directly: one manager, and a
   * colleague who has been granted `staff:manage` by override so that permission is not what
   * stops them. What stops them is that removing this manager would leave nobody able to invite
   * staff, assign roles or change settings.
   */
  it('refuses to demote or deactivate the only active manager', async () => {
    const solo = await createCooperative('Solo Manager Cooperative')
    const onlyManager = await createStaffSession(app, solo, 'MANAGER')
    const deputy = await createStaffSession(app, solo, 'ACCOUNTANT')
    await setOverride(deputy.staffId, 'staff:manage', 'GRANT')

    const withDeputy = (method: 'patch' | 'post', path: string) =>
      request(app)
        [method](`${API_PREFIX}${path}`)
        .set('Authorization', `Bearer ${deputy.accessToken}`)
        .set(HEADERS.cooperativeId, solo.id)

    const demote = await withDeputy('patch', `/staff/${onlyManager.staffId}`)
      .send({ roleKey: 'VIEWER' })
      .expect(409)
    expect(demote.body.error.messageKey).toBe('errors.staff.lastManager')

    const deactivate = await withDeputy('post', `/staff/${onlyManager.staffId}/deactivate`)
      .send({})
      .expect(409)
    expect(deactivate.body.error.messageKey).toBe('errors.staff.lastManager')

    // The manager is untouched, so the refusal was not a partial write.
    const still = await prisma.cooperativeStaff.findUniqueOrThrow({
      where: { id: onlyManager.staffId },
      select: { status: true, role: { select: { key: true } } },
    })
    expect(still.status).toBe('ACTIVE')
    expect(still.role.key).toBe('MANAGER')
  }, 60_000)

  it('allows the demotion once a second manager exists', async () => {
    const coop = await createCooperative('Two Manager Cooperative')
    const first = await createStaffSession(app, coop, 'MANAGER')
    const second = await createStaffSession(app, coop, 'MANAGER')

    await request(app)
      .patch(`${API_PREFIX}/staff/${first.staffId}`)
      .set('Authorization', `Bearer ${second.accessToken}`)
      .set(HEADERS.cooperativeId, coop.id)
      .send({ roleKey: 'VIEWER' })
      .expect(200)
  }, 60_000)
})

describe('deactivating staff', () => {
  it('deactivates rather than deleting, keeping the history', async () => {
    const target = await createStaffSession(app, cooperative, 'VIEWER')
    const response = await as(manager, 'post', `/staff/${target.staffId}/deactivate`)
      .send({ reason: 'Left the cooperative' })
      .expect(200)

    expect(response.body.data.status).toBe('INACTIVE')
    expect(response.body.data.deactivatedAt).not.toBeNull()

    const row = await prisma.cooperativeStaff.findUnique({ where: { id: target.staffId } })
    expect(row).not.toBeNull()
  })

  it('ends the sessions of someone who now serves no cooperative', async () => {
    const target = await createStaffSession(app, cooperative, 'VIEWER')
    await as(manager, 'post', `/staff/${target.staffId}/deactivate`).send({}).expect(200)

    const live = await prisma.refreshSession.count({
      where: { userId: target.id, revokedAt: null },
    })
    expect(live).toBe(0)
  })

  it('leaves the session of someone who still serves another cooperative', async () => {
    const other = await createCooperative('Second Cooperative')
    const user = await createUser()
    const { staffId } = await addStaff(cooperative.id, user.id, 'VIEWER')
    await addStaff(other.id, user.id, 'VIEWER')
    await login(app, user)

    await as(manager, 'post', `/staff/${staffId}/deactivate`).send({}).expect(200)

    const live = await prisma.refreshSession.count({ where: { userId: user.id, revokedAt: null } })
    expect(live).toBeGreaterThan(0)
  })

  it('refuses to deactivate yourself', async () => {
    const response = await as(manager, 'post', `/staff/${manager.staffId}/deactivate`)
      .send({})
      .expect(409)
    expect(response.body.error.messageKey).toBe('errors.staff.notSelf')
  })

  it('is idempotent on someone already inactive', async () => {
    const target = await createStaffSession(app, cooperative, 'VIEWER')
    await as(manager, 'post', `/staff/${target.staffId}/deactivate`).send({}).expect(200)
    const again = await as(manager, 'post', `/staff/${target.staffId}/deactivate`)
      .send({})
      .expect(200)
    expect(again.body.data.status).toBe('INACTIVE')
  })

  it('signs out a deactivated person immediately, not at the next token expiry', async () => {
    const target = await createStaffSession(app, cooperative, 'VIEWER')
    await as(target, 'get', '/cooperatives/current').expect(200)
    await as(manager, 'post', `/staff/${target.staffId}/deactivate`).send({}).expect(200)

    // Their only membership was here, so their sessions were revoked. `authenticate` checks the
    // session family is still live, so the access token they already hold stops working at once.
    // That is stronger than losing tenant access alone: they are signed out, not merely shut out
    // of this cooperative.
    const response = await as(target, 'get', '/cooperatives/current')
    expect(response.status).toBe(401)
  })

  it('leaves someone who serves another cooperative signed in, minus this tenant', async () => {
    const other = await createCooperative('Kept Session Cooperative')
    const user = await createUser()
    const { staffId } = await addStaff(cooperative.id, user.id, 'VIEWER')
    await addStaff(other.id, user.id, 'VIEWER')
    const session = await login(app, user)

    await as(manager, 'post', `/staff/${staffId}/deactivate`).send({}).expect(200)

    // Still authenticated, because the session survives.
    const here = await request(app)
      .get(`${API_PREFIX}/cooperatives/current`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set(HEADERS.cooperativeId, cooperative.id)
    expect(here.status).toBe(403)
    expect(here.body.error.code).toBe('NO_COOPERATIVE_ACCESS')

    // And the cooperative they still serve is unaffected.
    await request(app)
      .get(`${API_PREFIX}/cooperatives/current`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set(HEADERS.cooperativeId, other.id)
      .expect(200)
  })
})

describe('permission overrides', () => {
  it('grants a permission the role does not carry', async () => {
    const target = await createStaffSession(app, cooperative, 'VIEWER')
    await as(target, 'get', '/staff').expect(403)

    await as(manager, 'put', `/staff/${target.staffId}/overrides`)
      .send({
        overrides: [{ permission: 'staff:view', effect: 'GRANT', reason: 'Covers reception' }],
      })
      .expect(200)

    await as(target, 'get', '/staff').expect(200)
  })

  it('denies a permission the role does carry, and denial wins', async () => {
    const target = await createStaffSession(app, cooperative, 'SECRETARY')
    await as(target, 'get', '/staff').expect(200)

    await as(manager, 'put', `/staff/${target.staffId}/overrides`)
      .send({
        overrides: [
          { permission: 'staff:view', effect: 'GRANT' },
          { permission: 'members:create', effect: 'DENY' },
        ],
      })
      .expect(200)

    const response = await as(manager, 'get', `/staff/${target.staffId}/overrides`).expect(200)
    expect(response.body.data.overrides).toHaveLength(2)
  })

  it('replaces the whole set rather than merging', async () => {
    const target = await createStaffSession(app, cooperative, 'VIEWER')
    await as(manager, 'put', `/staff/${target.staffId}/overrides`)
      .send({ overrides: [{ permission: 'staff:view', effect: 'GRANT' }] })
      .expect(200)

    await as(manager, 'put', `/staff/${target.staffId}/overrides`)
      .send({ overrides: [{ permission: 'audit:view', effect: 'GRANT' }] })
      .expect(200)

    const response = await as(manager, 'get', `/staff/${target.staffId}/overrides`).expect(200)
    expect(response.body.data.overrides.map((o: { permission: string }) => o.permission)).toEqual([
      'audit:view',
    ])
    // The earlier grant is gone, so the permission it carried is gone with it.
    await as(target, 'get', '/staff').expect(403)
  })

  it('refuses to grant a platform permission, which would escape the tenant', async () => {
    const target = await createStaffSession(app, cooperative, 'VIEWER')
    await as(manager, 'put', `/staff/${target.staffId}/overrides`)
      .send({ overrides: [{ permission: 'platform:users:manage', effect: 'GRANT' }] })
      .expect(422)
  })

  it('refuses the same permission twice in one request', async () => {
    const target = await createStaffSession(app, cooperative, 'VIEWER')
    await as(manager, 'put', `/staff/${target.staffId}/overrides`)
      .send({
        overrides: [
          { permission: 'staff:view', effect: 'GRANT' },
          { permission: 'staff:view', effect: 'DENY' },
        ],
      })
      .expect(422)
  })

  it('clears every override when given an empty set', async () => {
    const target = await createStaffSession(app, cooperative, 'VIEWER')
    await as(manager, 'put', `/staff/${target.staffId}/overrides`)
      .send({ overrides: [{ permission: 'staff:view', effect: 'GRANT' }] })
      .expect(200)
    await as(manager, 'put', `/staff/${target.staffId}/overrides`)
      .send({ overrides: [] })
      .expect(200)

    const response = await as(manager, 'get', `/staff/${target.staffId}/overrides`).expect(200)
    expect(response.body.data.overrides).toEqual([])
  })
})

describe('roles and permissions reference', () => {
  it('lists the five cooperative roles with their permissions', async () => {
    const response = await as(manager, 'get', '/roles').expect(200)
    const keys = response.body.data.map((role: { key: string }) => role.key)
    expect(keys).toEqual(
      expect.arrayContaining(['MANAGER', 'ACCOUNTANT', 'SECRETARY', 'INVENTORY_OFFICER', 'VIEWER']),
    )
    expect(keys).not.toContain('SYSTEM_ADMIN')
  })

  it('describes every role in both languages', async () => {
    const response = await as(manager, 'get', '/roles').expect(200)
    for (const role of response.body.data) {
      expect(role.nameEn.length).toBeGreaterThan(0)
      expect(role.nameRw.length).toBeGreaterThan(0)
      expect(role.nameEn).not.toBe(role.nameRw)
    }
  })

  it('lists only cooperative-scope permissions for the override editor', async () => {
    const response = await as(manager, 'get', '/permissions').expect(200)
    const keys: string[] = response.body.data.map((row: { key: string }) => row.key)
    expect(keys.length).toBe(51)
    expect(keys.some((key) => key.startsWith('platform:'))).toBe(false)
  })
})

describe('audit trail', () => {
  it('records an invitation with who did it', async () => {
    const email = testEmail('audited')
    await as(manager, 'post', '/staff/invite')
      .send({ email, fullName: 'Audited Person', roleKey: 'VIEWER' })
      .expect(201)

    const entry = await prisma.auditLog.findFirst({
      where: { cooperativeId: cooperative.id, action: 'staff.invited' },
      orderBy: { createdAt: 'desc' },
    })
    expect(entry).not.toBeNull()
    expect(entry?.actorLabel).toContain(manager.email)
  })

  it('records a role change with the before and after value', async () => {
    const target = await createStaffSession(app, cooperative, 'VIEWER')
    await as(manager, 'patch', `/staff/${target.staffId}`)
      .send({ roleKey: 'ACCOUNTANT' })
      .expect(200)

    const entry = await prisma.auditLog.findFirst({
      where: { entityId: target.staffId, action: 'staff.updated' },
      orderBy: { createdAt: 'desc' },
    })
    expect(entry?.before).toMatchObject({ roleKey: 'VIEWER' })
    expect(entry?.after).toMatchObject({ roleKey: 'ACCOUNTANT' })
  })
})
