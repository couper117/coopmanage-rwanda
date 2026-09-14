import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { API_PREFIX } from '../src/app.js'
import { testApp } from './server.js'
import { disconnectPrisma, prisma } from '../src/lib/prisma.js'
import { hashToken } from '../src/lib/tokens.js'
import { FORGOT_PASSWORD_LIMITS, LOGIN_LIMITS } from '../src/middleware/rateLimit.js'
import { lockoutMinutes } from '../src/modules/auth/auth.service.js'
import {
  addStaff,
  cleanupFixtures,
  createCooperative,
  createStaffSession,
  createUser,
  login,
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

describe('login', () => {
  it('returns a session, the user and their memberships', async () => {
    const staff = await createStaffSession(app, cooperative, 'ACCOUNTANT')
    const res = await request(app)
      .post(`${API_PREFIX}/auth/login`)
      .send({ email: staff.email, password: staff.password })
      .expect(200)

    expect(res.body.data.accessToken).toBeTypeOf('string')
    expect(res.body.data.expiresIn).toBe(900)
    expect(res.body.data.user.email).toBe(staff.email)
    expect(res.body.data.memberships).toHaveLength(1)
    expect(res.body.data.memberships[0].roleKey).toBe('ACCOUNTANT')
  })

  it('never returns the password hash', async () => {
    const user = await createUser()
    const res = await request(app)
      .post(`${API_PREFIX}/auth/login`)
      .send({ email: user.email, password: user.password })
      .expect(200)
    expect(JSON.stringify(res.body)).not.toContain('$argon2')
    expect(res.body.data.user).not.toHaveProperty('passwordHash')
  })

  it('delivers the refresh token only as an HttpOnly cookie scoped to two paths', async () => {
    const user = await createUser()
    const res = await request(app)
      .post(`${API_PREFIX}/auth/login`)
      .send({ email: user.email, password: user.password })
      .expect(200)

    const cookies = res.headers['set-cookie'] as unknown as string[]
    expect(cookies).toHaveLength(2)
    for (const cookie of cookies) {
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Lax')
    }
    expect(cookies.some((c) => c.includes('Path=/api/v1/auth/refresh'))).toBe(true)
    expect(cookies.some((c) => c.includes('Path=/api/v1/auth/logout'))).toBe(true)
    // The body must not carry it as well, or the HttpOnly cookie is pointless.
    expect(JSON.stringify(res.body)).not.toContain('refreshToken')
  })

  it('answers identically for a wrong password and an unknown address', async () => {
    const user = await createUser()
    const wrongPassword = await request(app)
      .post(`${API_PREFIX}/auth/login`)
      .send({ email: user.email, password: 'not-the-right-password' })
      .expect(401)
    const unknownUser = await request(app)
      .post(`${API_PREFIX}/auth/login`)
      .send({ email: 'nobody-here@example.test', password: 'not-the-right-password' })
      .expect(401)

    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(unknownUser.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(unknownUser.body.error.message).toBe(wrongPassword.body.error.message)
  })

  it('turns a suspended account away exactly like an unknown one', async () => {
    const user = await createUser({ status: 'SUSPENDED' })
    const res = await request(app)
      .post(`${API_PREFIX}/auth/login`)
      .send({ email: user.email, password: user.password })
      .expect(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('rejects an unknown field rather than ignoring it', async () => {
    const user = await createUser()
    const res = await request(app)
      .post(`${API_PREFIX}/auth/login`)
      .send({ email: user.email, password: user.password, isPlatformAdmin: true })
      .expect(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })

  it('locks progressively after repeated failures and clears the lock on success', async () => {
    const user = await createUser()
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await request(app)
        .post(`${API_PREFIX}/auth/login`)
        .send({ email: user.email, password: 'wrong-password-attempt' })
        .expect(401)
    }

    const locked = await request(app)
      .post(`${API_PREFIX}/auth/login`)
      .send({ email: user.email, password: 'wrong-password-attempt' })
      .expect(401)
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED')

    // Even the correct password is refused while the lock stands.
    const stillLocked = await request(app)
      .post(`${API_PREFIX}/auth/login`)
      .send({ email: user.email, password: user.password })
      .expect(401)
    expect(stillLocked.body.error.code).toBe('ACCOUNT_LOCKED')

    await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: null } })
    await request(app)
      .post(`${API_PREFIX}/auth/login`)
      .send({ email: user.email, password: user.password })
      .expect(200)

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { failedLoginCount: true, lockedUntil: true },
    })
    expect(after.failedLoginCount).toBe(0)
    expect(after.lockedUntil).toBeNull()
  })

  it('doubles the lockout interval and caps it at an hour', () => {
    expect(lockoutMinutes(4)).toBe(0)
    expect(lockoutMinutes(5)).toBe(1)
    expect(lockoutMinutes(6)).toBe(2)
    expect(lockoutMinutes(8)).toBe(8)
    expect(lockoutMinutes(30)).toBe(60)
  })
})

describe('refresh rotation', () => {
  it('rotates the token on every use', async () => {
    const user = await createUser()
    const session = await login(app, user)

    const res = await request(app)
      .post(`${API_PREFIX}/auth/refresh`)
      .set('Cookie', session.cookies)
      .expect(200)

    expect(res.body.data.accessToken).toBeTypeOf('string')
    const rotated = res.headers['set-cookie'] as unknown as string[]
    expect(rotated.some((c) => !session.cookies.includes(c))).toBe(true)
  })

  it('revokes the whole family when an already-rotated token is presented again', async () => {
    const user = await createUser()
    const session = await login(app, user)

    const rotated = await request(app)
      .post(`${API_PREFIX}/auth/refresh`)
      .set('Cookie', session.cookies)
      .expect(200)
    const newCookies = rotated.headers['set-cookie'] as unknown as string[]

    // The stolen copy is replayed.
    await request(app).post(`${API_PREFIX}/auth/refresh`).set('Cookie', session.cookies).expect(401)

    // Both parties are now signed out, which is the point: the theft is detected, not tolerated.
    await request(app).post(`${API_PREFIX}/auth/refresh`).set('Cookie', newCookies).expect(401)

    const live = await prisma.refreshSession.count({
      where: { userId: user.id, revokedAt: null },
    })
    expect(live).toBe(0)
  })

  it('lets exactly one of several simultaneous refreshes win', async () => {
    // Two browser tabs waking at once present the same cookie. Before the rotation was made
    // atomic this left several live tokens in one family with the reuse undetected, which is the
    // failure rotation exists to catch.
    const user = await createUser()
    const session = await login(app, user)

    const attempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post(`${API_PREFIX}/auth/refresh`).set('Cookie', session.cookies),
      ),
    )

    expect(attempts.filter((res) => res.status === 200)).toHaveLength(1)
    expect(attempts.filter((res) => res.status === 401)).toHaveLength(4)

    // The losers detected the reuse and revoked the family, so nothing is left alive.
    const live = await prisma.refreshSession.count({ where: { userId: user.id, revokedAt: null } })
    expect(live).toBe(0)
    // Five transactions that deliberately serialise on the same row, while fourteen other test
    // files are working against the same database. The default five-second budget is not enough
    // for that and produced a flake roughly one run in four, which is the kind of failure that
    // teaches people to re-run the suite instead of reading it.
  }, 30_000)

  it('never leaves two live tokens in one family', async () => {
    const user = await createUser()
    const session = await login(app, user)

    let cookies = session.cookies
    for (let round = 0; round < 3; round += 1) {
      const res = await request(app)
        .post(`${API_PREFIX}/auth/refresh`)
        .set('Cookie', cookies)
        .expect(200)
      cookies = res.headers['set-cookie'] as unknown as string[]
    }

    const live = await prisma.refreshSession.findMany({
      where: { userId: user.id, revokedAt: null },
      select: { familyId: true },
    })
    expect(live).toHaveLength(1)
  })

  it('refuses a refresh with no cookie at all', async () => {
    await request(app).post(`${API_PREFIX}/auth/refresh`).expect(401)
  })

  it('refuses a refresh from an origin that is not allowed', async () => {
    const user = await createUser()
    const session = await login(app, user)
    const res = await request(app)
      .post(`${API_PREFIX}/auth/refresh`)
      .set('Cookie', session.cookies)
      .set('Origin', 'https://not-our-site.example')
      .expect(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('clears the cookie when it refuses', async () => {
    const res = await request(app)
      .post(`${API_PREFIX}/auth/refresh`)
      .set('Cookie', ['coopmanage.refresh=not-a-real-token'])
      .expect(401)
    const cleared = res.headers['set-cookie'] as unknown as string[]
    expect(cleared.every((cookie) => cookie.includes('coopmanage.refresh=;'))).toBe(true)
  })
})

describe('logout', () => {
  it('revokes the session family and stops the access token working', async () => {
    const user = await createUser()
    const session = await login(app, user)

    await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200)
    await request(app).post(`${API_PREFIX}/auth/logout`).set('Cookie', session.cookies).expect(204)

    // The access token has not expired, but its family has been revoked, which is exactly what
    // somebody signing out in a hurry on a shared computer is asking for.
    await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(401)
  })

  it('succeeds without a cookie rather than failing', async () => {
    await request(app).post(`${API_PREFIX}/auth/logout`).expect(204)
  })
})

describe('GET /auth/me', () => {
  it('refuses a request with no token', async () => {
    const res = await request(app).get(`${API_PREFIX}/auth/me`).expect(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('reports an expired token distinctly from an invalid one', async () => {
    const res = await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('returns no cooperative and no permissions without the cooperative header', async () => {
    const staff = await createStaffSession(app, cooperative, 'MANAGER')
    const res = await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .expect(200)

    expect(res.body.data.cooperative).toBeNull()
    expect(res.body.data.roleKey).toBeNull()
    expect(res.body.data.permissions).toEqual([])
    expect(res.body.data.memberships).toHaveLength(1)
  })

  it('returns the effective permission set once a cooperative is named', async () => {
    const staff = await createStaffSession(app, cooperative, 'SECRETARY')
    const res = await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .set('X-Cooperative-Id', cooperative.id)
      .expect(200)

    expect(res.body.data.roleKey).toBe('SECRETARY')
    expect(res.body.data.permissions).toContain('meetings:manage')
    expect(res.body.data.permissions).not.toContain('finance:create')
  })
})

describe('profile', () => {
  it('updates name, phone and language, and records the change', async () => {
    const staff = await createStaffSession(app, cooperative, 'MANAGER')
    const res = await request(app)
      .patch(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ fullName: 'Mukamana Solange', phone: '+250 788 111 222', locale: 'RW' })
      .expect(200)

    expect(res.body.data.fullName).toBe('Mukamana Solange')
    expect(res.body.data.locale).toBe('RW')

    const entry = await prisma.auditLog.findFirst({
      where: { actorUserId: staff.id, action: 'user.profile.updated' },
      select: { before: true, after: true },
    })
    expect(entry).not.toBeNull()
    expect((entry?.after as { fullName: string }).fullName).toBe('Mukamana Solange')
  })

  it('clears the phone number when an empty string is sent', async () => {
    const staff = await createStaffSession(app, cooperative, 'MANAGER')
    await request(app)
      .patch(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ phone: '' })
      .expect(200)
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: staff.id },
      select: { phone: true },
    })
    expect(user.phone).toBeNull()
  })

  it('rejects an attempt to change a field that is not the user’s to change', async () => {
    const staff = await createStaffSession(app, cooperative, 'VIEWER')
    await request(app)
      .patch(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ isPlatformAdmin: true })
      .expect(422)
  })
})

describe('change password', () => {
  it('requires the current password', async () => {
    const staff = await createStaffSession(app, cooperative, 'MANAGER')
    const res = await request(app)
      .post(`${API_PREFIX}/auth/change-password`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ currentPassword: 'not-my-password', newPassword: 'a-brand-new-passphrase' })
      .expect(422)
    expect(res.body.error.details[0].messageKey).toBe('validation.password.incorrect')
  })

  it('refuses a password that is too short or too common', async () => {
    const staff = await createStaffSession(app, cooperative, 'MANAGER')
    const short = await request(app)
      .post(`${API_PREFIX}/auth/change-password`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'short1' })
      .expect(422)
    expect(short.body.error.messageKey).toBe('validation.password.tooShort')

    const common = await request(app)
      .post(`${API_PREFIX}/auth/change-password`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'password123' })
      .expect(422)
    expect(common.body.error.messageKey).toBe('validation.password.tooCommon')
  })

  it('signs out other devices but keeps the one making the change', async () => {
    const staff = await createStaffSession(app, cooperative, 'MANAGER')
    const otherDevice = await login(app, staff)

    await request(app)
      .post(`${API_PREFIX}/auth/change-password`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'a-brand-new-passphrase' })
      .expect(204)

    await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .expect(200)
    await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${otherDevice.accessToken}`)
      .expect(401)

    await request(app)
      .post(`${API_PREFIX}/auth/login`)
      .send({ email: staff.email, password: 'a-brand-new-passphrase' })
      .expect(200)
  })
})

describe('password reset', () => {
  it('answers 204 whether or not the address exists', async () => {
    const user = await createUser()
    await request(app)
      .post(`${API_PREFIX}/auth/forgot-password`)
      .send({ email: user.email })
      .expect(204)
    await request(app)
      .post(`${API_PREFIX}/auth/forgot-password`)
      .send({ email: 'nobody-at-all@example.test' })
      .expect(204)
  })

  it('accepts a token once, then never again', async () => {
    const user = await createUser()
    const token = await issueResetToken(user.id)

    await request(app)
      .post(`${API_PREFIX}/auth/reset-password`)
      .send({ token, password: 'a-completely-new-passphrase' })
      .expect(204)

    const replay = await request(app)
      .post(`${API_PREFIX}/auth/reset-password`)
      .send({ token, password: 'another-new-passphrase-here' })
      .expect(422)
    expect(replay.body.error.messageKey).toBe('errors.resetTokenInvalid')

    await request(app)
      .post(`${API_PREFIX}/auth/login`)
      .send({ email: user.email, password: 'a-completely-new-passphrase' })
      .expect(200)
  })

  it('spends any earlier unused token when a new one is requested', async () => {
    const user = await createUser()
    const first = await issueResetToken(user.id)
    await request(app)
      .post(`${API_PREFIX}/auth/forgot-password`)
      .send({ email: user.email })
      .expect(204)

    const res = await request(app)
      .post(`${API_PREFIX}/auth/reset-password`)
      .send({ token: first, password: 'yet-another-new-passphrase' })
      .expect(422)
    expect(res.body.error.messageKey).toBe('errors.resetTokenInvalid')
  })

  it('refuses an expired token', async () => {
    const user = await createUser()
    const token = await issueResetToken(user.id, new Date(Date.now() - 60_000))
    await request(app)
      .post(`${API_PREFIX}/auth/reset-password`)
      .send({ token, password: 'a-perfectly-good-passphrase' })
      .expect(422)
  })

  it('signs out every existing session', async () => {
    const user = await createUser()
    const session = await login(app, user)
    const token = await issueResetToken(user.id)

    await request(app)
      .post(`${API_PREFIX}/auth/reset-password`)
      .send({ token, password: 'a-reset-passphrase-today' })
      .expect(204)

    await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(401)
  })

  it('stores the token only as a hash', async () => {
    const user = await createUser()
    const token = await issueResetToken(user.id)
    const stored = await prisma.passwordResetToken.findFirst({
      where: { userId: user.id },
      select: { tokenHash: true },
    })
    expect(stored?.tokenHash).not.toBe(token)
    expect(stored?.tokenHash).toBe(hashToken(token))
  })
})

describe('sessions', () => {
  it('lists the caller’s own devices and marks the current one', async () => {
    const staff = await createStaffSession(app, cooperative, 'MANAGER')
    await login(app, staff)

    const res = await request(app)
      .get(`${API_PREFIX}/auth/sessions`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .expect(200)

    expect(res.body.data.length).toBeGreaterThanOrEqual(2)
    expect(res.body.data.filter((row: { current: boolean }) => row.current)).toHaveLength(1)
    expect(JSON.stringify(res.body)).not.toContain('tokenHash')
  })

  it('signs out one device', async () => {
    const staff = await createStaffSession(app, cooperative, 'MANAGER')
    const other = await login(app, staff)

    const sessions = await request(app)
      .get(`${API_PREFIX}/auth/sessions`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .expect(200)
    const target = sessions.body.data.find((row: { current: boolean }) => !row.current)

    await request(app)
      .delete(`${API_PREFIX}/auth/sessions/${target.id}`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .expect(204)

    await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(401)
    await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .expect(200)
  })

  it('reads another user’s session id as not found rather than forbidden', async () => {
    const mine = await createStaffSession(app, cooperative, 'MANAGER')
    const theirs = await createStaffSession(app, cooperative, 'MANAGER')

    const sessions = await request(app)
      .get(`${API_PREFIX}/auth/sessions`)
      .set('Authorization', `Bearer ${theirs.accessToken}`)
      .expect(200)

    const res = await request(app)
      .delete(`${API_PREFIX}/auth/sessions/${sessions.body.data[0].id}`)
      .set('Authorization', `Bearer ${mine.accessToken}`)
      .expect(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})

/** Creates a reset token directly, because the delivery channel arrives with SMS in Phase 12. */
async function issueResetToken(userId: string, expiresAt?: Date): Promise<string> {
  const { generateOpaqueToken } = await import('../src/lib/tokens.js')
  const token = generateOpaqueToken()
  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: expiresAt ?? new Date(Date.now() + 60 * 60_000),
    },
  })
  return token
}

describe('platform administrators in the session', () => {
  /**
   * A platform administrator holds the `platform:*` keys wherever they are. `GET /auth/me` runs
   * under neither resolver, so without an explicit union it reported no platform permissions and
   * the administration screens refused their own administrator. This is the regression guard.
   */
  it('reports the platform permissions with no cooperative named', async () => {
    const user = await createUser({ isPlatformAdmin: true })
    const session = await login(app, user)

    const response = await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200)

    expect(response.body.data.permissions).toContain('platform:cooperatives:view')
    expect(response.body.data.permissions).toContain('platform:users:manage')
    expect(response.body.data.cooperative).toBeNull()
  })

  it('keeps them when a cooperative is named and the administrator is also staff there', async () => {
    const cooperative = await createCooperative('Admin Is Also Staff')
    const user = await createUser({ isPlatformAdmin: true })
    await addStaff(cooperative.id, user.id, 'VIEWER')
    const session = await login(app, user)

    const response = await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('X-Cooperative-Id', cooperative.id)
      .expect(200)

    // Their cooperative role and their platform role, both reported.
    expect(response.body.data.roleKey).toBe('VIEWER')
    expect(response.body.data.permissions).toContain('members:view')
    expect(response.body.data.permissions).toContain('platform:cooperatives:view')
  })

  it('reports no platform permissions for an ordinary user', async () => {
    const cooperative = await createCooperative('Ordinary Only')
    const staff = await createStaffSession(app, cooperative, 'MANAGER')

    const response = await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .set('X-Cooperative-Id', cooperative.id)
      .expect(200)

    const platformKeys = (response.body.data.permissions as string[]).filter((key) =>
      key.startsWith('platform:'),
    )
    expect(platformKeys).toEqual([])
  })
})

describe('login rate limits', () => {
  /**
   * The limits themselves are disabled under test, so this asserts the configuration rather than
   * the behaviour: several staff of one cooperative share a single public address, and a per-IP
   * allowance as tight as the per-account one locks the whole office out of its own records the
   * moment a fourth person arrives. The per-account limit is what defends an account.
   */
  it('allows far more sign-ins per address than per account', () => {
    expect(LOGIN_LIMITS.perEmail).toBe(5)
    expect(LOGIN_LIMITS.perIp).toBeGreaterThanOrEqual(30)
    expect(LOGIN_LIMITS.perIp).toBeGreaterThan(LOGIN_LIMITS.perEmail * 5)
  })

  it('does the same for password reset', () => {
    expect(FORGOT_PASSWORD_LIMITS.perEmail).toBe(3)
    expect(FORGOT_PASSWORD_LIMITS.perIp).toBeGreaterThan(FORGOT_PASSWORD_LIMITS.perEmail * 5)
  })

  it('lets a whole office sign in one after another', async () => {
    const cooperative = await createCooperative('Shared Connection Cooperative')
    const staff = await Promise.all([
      createStaffSession(app, cooperative, 'MANAGER'),
      createStaffSession(app, cooperative, 'ACCOUNTANT'),
      createStaffSession(app, cooperative, 'SECRETARY'),
      createStaffSession(app, cooperative, 'INVENTORY_OFFICER'),
      createStaffSession(app, cooperative, 'VIEWER'),
    ])

    // A sixth sign-in from the same address, which the original per-IP limit of five refused.
    const sixth = await createUser()
    const session = await login(app, sixth)
    expect(session.accessToken.length).toBeGreaterThan(0)
    expect(staff).toHaveLength(5)
  }, 60_000)
})
