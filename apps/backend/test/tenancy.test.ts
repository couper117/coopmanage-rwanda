import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HEADERS } from '@coopmanage/shared'
import { API_PREFIX } from '../src/app.js'
import { testApp } from './server.js'
import { disconnectPrisma, prisma } from '../src/lib/prisma.js'
import { registeredRoutes, type RegisteredRoute } from '../src/lib/routeRegistry.js'
import '../src/routes.js'
import {
  addStaff,
  cleanupFixtures,
  createCooperative,
  createStaffSession,
  createUser,
  login,
  type Session,
  type TestUser,
  type TestCooperative,
} from './fixtures.js'

const app = testApp()

/**
 * The cross-tenant sweep. This is the automated proof behind the Phase 3 exit criterion and the
 * fourth of the four tenancy layers in `docs/architecture.md` section 4: a user of Cooperative A
 * must receive "not found" for every one of Cooperative B's identifiers, and must not be able to
 * reach Cooperative B at all by changing a header.
 *
 * It is driven from the route registry rather than from a hand-written list of URLs, so a route
 * added in a later phase is swept the moment it is registered. A route carrying a path parameter
 * has to be accounted for in one of the two tables below; the coverage test fails the build if one
 * is not, which is what stops this suite from quietly going out of date.
 */

interface Tenant {
  cooperative: TestCooperative
  manager: TestUser & Session & { staffId: string }
  otherStaffId: string
  memberId: string
  contributionId: string
  shareId: string
}

let a: Tenant
let b: Tenant
let platformAdmin: Session

async function buildTenant(name: string): Promise<Tenant> {
  const cooperative = await createCooperative(name)
  const manager = await createStaffSession(app, cooperative, 'MANAGER')
  const second = await createUser()
  const { staffId } = await addStaff(cooperative.id, second.id, 'SECRETARY')

  // A member, a contribution and a share purchase, so the sweep has genuine records of this
  // cooperative to try against the other one. A fictional identifier would pass the test for the
  // wrong reason.
  const category = await seedIncomeCategory(cooperative.id)
  const member = await request(app)
    .post(`${API_PREFIX}/members`)
    .set('Authorization', `Bearer ${manager.accessToken}`)
    .set(HEADERS.cooperativeId, cooperative.id)
    .send({ firstName: 'Uwase', lastName: name.replace(/\s+/g, '') })
    .expect(201)

  const contribution = await request(app)
    .post(`${API_PREFIX}/members/${member.body.data.id as string}/contributions`)
    .set('Authorization', `Bearer ${manager.accessToken}`)
    .set(HEADERS.cooperativeId, cooperative.id)
    .send({ type: 'MEMBERSHIP_FEE', amount: '5000', method: 'CASH', categoryId: category })
    .expect(201)

  const share = await request(app)
    .post(`${API_PREFIX}/members/${member.body.data.id as string}/shares`)
    .set('Authorization', `Bearer ${manager.accessToken}`)
    .set(HEADERS.cooperativeId, cooperative.id)
    .send({ type: 'PURCHASE', quantity: 2, unitValue: '10000', categoryId: category })
    .expect(201)

  return {
    cooperative,
    manager,
    otherStaffId: staffId,
    memberId: member.body.data.id as string,
    contributionId: contribution.body.data.id as string,
    shareId: share.body.data.id as string,
  }
}

/** A cooperative needs at least one income category before a contribution can be posted. */
async function seedIncomeCategory(cooperativeId: string): Promise<string> {
  const category = await prisma.financeCategory.create({
    data: { cooperativeId, kind: 'INCOME', name: 'Membership fees', isSystem: true },
    select: { id: true },
  })
  return category.id
}

beforeAll(async () => {
  a = await buildTenant('Koperative A')
  b = await buildTenant('Koperative B')
  const admin = await createUser({ isPlatformAdmin: true })
  platformAdmin = await login(app, admin)
}, 60_000)

afterAll(async () => {
  await cleanupFixtures()
  await disconnectPrisma()
})

/**
 * How each parameterised tenant-scoped route is swept.
 *
 * `FOREIGN_IDENTIFIERS` names routes whose parameter is a record belonging to a cooperative, and
 * supplies Cooperative B's value for it plus a body that passes validation. A body is needed
 * because validation runs before the service, exactly as `docs/permissions.md` section 5 sets out,
 * so an empty body would be refused with 422 and the sweep would never reach the tenancy check.
 *
 * `NOT_AN_IDENTIFIER` names routes whose parameter is not a record at all — a setting key, for
 * instance — so there is nothing belonging to another cooperative to substitute. Listing them
 * here is a deliberate statement rather than an omission.
 */
function foreignIdentifiers(): Record<string, { id: string; body?: object }> {
  return {
    '/staff/:id': { id: b.otherStaffId, body: { jobTitle: 'Umunyamabanga' } },
    '/staff/:id/deactivate': { id: b.otherStaffId, body: {} },
    '/staff/:id/overrides': { id: b.otherStaffId, body: { overrides: [] } },
    '/members/:id': { id: b.memberId, body: { notes: 'edited from the wrong cooperative' } },
    '/members/:id/status': { id: b.memberId, body: { status: 'INACTIVE' } },
    '/members/:id/summary': { id: b.memberId },
    '/members/:id/timeline': { id: b.memberId },
    '/members/:id/shares': {
      id: b.memberId,
      body: { type: 'REDEMPTION', quantity: 1, unitValue: '1000' },
    },
    '/members/:id/contributions': {
      id: b.memberId,
      body: { type: 'SAVINGS', amount: '1000', method: 'CASH', categoryId: b.cooperative.id },
    },
    '/contributions/:id/void': { id: b.contributionId, body: {} },
  }
}

/**
 * Routes whose path carries two identifiers. The member is substituted with Cooperative B's
 * member and the share with Cooperative B's share, so the whole address belongs to the other
 * cooperative rather than being half valid.
 */
function foreignPairs(): Record<string, { values: Record<string, string>; body?: object }> {
  return {
    '/members/:id/shares/:shareId/void': {
      values: { id: b.memberId, shareId: b.shareId },
      body: {},
    },
  }
}

const NOT_AN_IDENTIFIER: readonly string[] = [
  // The parameter is a key from the settings catalogue, not a row. Tenancy for this route is
  // carried entirely by the resolved cooperative, which the header tests above cover.
  '/settings/:key',
]

function isPlatformRoute(route: RegisteredRoute): boolean {
  return (
    route.path.startsWith('/admin') ||
    (route.access.kind === 'PERMISSION' && route.access.permission.startsWith('platform:'))
  )
}

function isTenantScoped(route: RegisteredRoute): boolean {
  return route.access.kind === 'PERMISSION' && !isPlatformRoute(route)
}

function send(route: RegisteredRoute, path: string, session: Session, cooperativeId?: string) {
  const method = route.method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete'
  const call = request(app)
    [method](`${API_PREFIX}${path}`)
    .set('Authorization', `Bearer ${session.accessToken}`)
  if (cooperativeId) call.set(HEADERS.cooperativeId, cooperativeId)
  return call.send({})
}

describe('tenant isolation: the header cannot select another cooperative', () => {
  it('refuses every tenant-scoped route when the header names a cooperative the caller does not serve', async () => {
    const routes = registeredRoutes().filter(isTenantScoped)
    expect(routes.length).toBeGreaterThan(0)

    for (const route of routes) {
      // Cooperative A's manager, pointing the header at Cooperative B.
      const path = route.path.replace(/:(\w+)/g, () => b.otherStaffId)
      const response = await send(route, path, a.manager, b.cooperative.id)

      expect(
        response.status,
        `${route.method} ${route.path} allowed a cross-tenant header (${response.status})`,
      ).toBe(403)
      expect(response.body.error.code).toBe('NO_COOPERATIVE_ACCESS')
    }
  }, 120_000)

  it('refuses every tenant-scoped route when no cooperative is named at all', async () => {
    for (const route of registeredRoutes().filter(isTenantScoped)) {
      const path = route.path.replace(/:(\w+)/g, () => a.otherStaffId)
      const response = await send(route, path, a.manager)
      expect(response.status, `${route.method} ${route.path}`).toBe(403)
      expect(response.body.error.code).toBe('NO_COOPERATIVE_ACCESS')
    }
  }, 120_000)

  it('refuses a cooperative id that is well formed but does not exist', async () => {
    const response = await send(
      { method: 'GET', path: '/cooperatives/current', access: { kind: 'PUBLIC' } },
      '/cooperatives/current',
      a.manager,
      '00000000-0000-4000-8000-000000000000',
    )
    expect(response.status).toBe(403)
  })

  it('refuses a cooperative id that is not a uuid, without reaching the database', async () => {
    const response = await send(
      { method: 'GET', path: '/cooperatives/current', access: { kind: 'PUBLIC' } },
      '/cooperatives/current',
      a.manager,
      'not-a-uuid',
    )
    expect(response.status).toBe(403)
  })
})

describe("tenant isolation: another cooperative's identifiers report not found", () => {
  const parameterised = () =>
    registeredRoutes().filter((route) => isTenantScoped(route) && route.path.includes(':'))

  it('accounts for every parameterised tenant-scoped route', () => {
    const single = foreignIdentifiers()
    const pairs = foreignPairs()
    const unaccounted = [
      ...new Set(
        parameterised()
          .map((route) => route.path)
          .filter(
            (path) => !(path in single) && !(path in pairs) && !NOT_AN_IDENTIFIER.includes(path),
          ),
      ),
    ]
    expect(
      unaccounted,
      `add these routes to foreignIdentifiers(), foreignPairs() or NOT_AN_IDENTIFIER in tenancy.test.ts: ${unaccounted.join(', ')}`,
    ).toEqual([])
  })

  it("answers 404 for Cooperative B's identifiers inside Cooperative A", async () => {
    const table = foreignIdentifiers()
    const pairs = foreignPairs()
    let swept = 0

    for (const route of parameterised()) {
      const entry = table[route.path]
      const pair = pairs[route.path]
      if (!entry && !pair) continue

      const path = pair
        ? route.path.replace(/:(\w+)/g, (_match, name: string) => pair.values[name] as string)
        : route.path.replace(/:(\w+)/g, () => (entry as { id: string }).id)

      // A's own manager, A's own header, B's identifier.
      const method = route.method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete'
      const response = await request(app)
        [method](`${API_PREFIX}${path}`)
        .set('Authorization', `Bearer ${a.manager.accessToken}`)
        .set(HEADERS.cooperativeId, a.cooperative.id)
        .send((pair ?? entry)?.body ?? {})

      expect(
        response.status,
        `${route.method} ${route.path} leaked a foreign record (${response.status})`,
      ).toBe(404)
      expect(response.body.error.code).toBe('NOT_FOUND')
      swept += 1
    }

    // Guards against the loop silently sweeping nothing, which would make this test vacuous.
    expect(swept).toBeGreaterThanOrEqual(4)
  }, 120_000)

  it("does not leak whether B's identifier exists, versus one that never existed", async () => {
    const real = b.otherStaffId
    const fictional = '11111111-1111-4111-8111-111111111111'

    const [foreign, unknown] = await Promise.all([
      request(app)
        .get(`${API_PREFIX}/staff/${real}/overrides`)
        .set('Authorization', `Bearer ${a.manager.accessToken}`)
        .set(HEADERS.cooperativeId, a.cooperative.id),
      request(app)
        .get(`${API_PREFIX}/staff/${fictional}/overrides`)
        .set('Authorization', `Bearer ${a.manager.accessToken}`)
        .set(HEADERS.cooperativeId, a.cooperative.id),
    ])

    expect(foreign.status).toBe(unknown.status)
    expect(foreign.body.error.code).toBe(unknown.body.error.code)
  })

  it('does let a cooperative reach its own records, so the sweep is not passing vacuously', async () => {
    const response = await request(app)
      .get(`${API_PREFIX}/staff/${a.otherStaffId}/overrides`)
      .set('Authorization', `Bearer ${a.manager.accessToken}`)
      .set(HEADERS.cooperativeId, a.cooperative.id)
    expect(response.status).toBe(200)
    expect(response.body.data.staff.id).toBe(a.otherStaffId)
  })
})

describe('tenant isolation: writes cannot cross a tenant boundary', () => {
  it("refuses to change a role on B's staff row from inside A", async () => {
    const response = await request(app)
      .patch(`${API_PREFIX}/staff/${b.otherStaffId}`)
      .set('Authorization', `Bearer ${a.manager.accessToken}`)
      .set(HEADERS.cooperativeId, a.cooperative.id)
      .send({ roleKey: 'MANAGER' })

    expect(response.status).toBe(404)

    const untouched = await prisma.cooperativeStaff.findUniqueOrThrow({
      where: { id: b.otherStaffId },
      select: { role: { select: { key: true } } },
    })
    expect(untouched.role.key).toBe('SECRETARY')
  })

  it('refuses to write a setting into B while A is the active cooperative', async () => {
    await request(app)
      .put(`${API_PREFIX}/settings/enabledModules`)
      .set('Authorization', `Bearer ${a.manager.accessToken}`)
      .set(HEADERS.cooperativeId, b.cooperative.id)
      .send({ value: [] })
      .expect(403)

    const leaked = await prisma.cooperativeSetting.findFirst({
      where: { cooperativeId: b.cooperative.id },
    })
    expect(leaked).toBeNull()
  })

  it('keeps settings separate between cooperatives', async () => {
    await request(app)
      .put(`${API_PREFIX}/settings/enabledModules`)
      .set('Authorization', `Bearer ${a.manager.accessToken}`)
      .set(HEADERS.cooperativeId, a.cooperative.id)
      .send({ value: ['inventory', 'sales'] })
      .expect(200)

    const bSettings = await request(app)
      .get(`${API_PREFIX}/settings`)
      .set('Authorization', `Bearer ${b.manager.accessToken}`)
      .set(HEADERS.cooperativeId, b.cooperative.id)
      .expect(200)

    // B still has every optional module, because A's change was A's alone.
    expect(bSettings.body.data.enabledModules.length).toBeGreaterThan(2)
  })
})

describe('platform surface', () => {
  it('answers 404 on every /admin route for a caller who is not a platform administrator', async () => {
    const routes = registeredRoutes().filter(isPlatformRoute)
    expect(routes.length).toBeGreaterThan(0)

    for (const route of routes) {
      const path = route.path.replace(/:(\w+)/g, () => '11111111-1111-4111-8111-111111111111')
      const response = await send(route, path, a.manager)
      expect(
        response.status,
        `${route.method} ${route.path} revealed itself to an ordinary user (${response.status})`,
      ).toBe(404)
    }
  }, 120_000)

  it('is reachable by a platform administrator', async () => {
    const response = await request(app)
      .get(`${API_PREFIX}/admin/cooperatives`)
      .set('Authorization', `Bearer ${platformAdmin.accessToken}`)
      .expect(200)
    expect(Array.isArray(response.body.data)).toBe(true)
  })

  it('writes an audit entry when a platform administrator reaches into a cooperative', async () => {
    await request(app)
      .get(`${API_PREFIX}/cooperatives/current`)
      .set('Authorization', `Bearer ${platformAdmin.accessToken}`)
      .set(HEADERS.cooperativeId, b.cooperative.id)
      .expect(200)

    const entry = await prisma.auditLog.findFirst({
      where: { cooperativeId: b.cooperative.id, action: 'platform.tenant_access' },
      orderBy: { createdAt: 'desc' },
    })
    expect(entry).not.toBeNull()
  })

  it('gives a platform administrator no write access inside a cooperative', async () => {
    const response = await request(app)
      .patch(`${API_PREFIX}/cooperatives/current`)
      .set('Authorization', `Bearer ${platformAdmin.accessToken}`)
      .set(HEADERS.cooperativeId, b.cooperative.id)
      .send({ name: 'Renamed by the platform' })

    expect(response.status).toBe(403)
    const unchanged = await prisma.cooperative.findUniqueOrThrow({
      where: { id: b.cooperative.id },
      select: { name: true },
    })
    expect(unchanged.name).toBe('Koperative B')
  })
})
