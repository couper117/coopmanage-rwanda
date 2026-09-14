import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ALL_PERMISSIONS,
  COOPERATIVE_PERMISSIONS,
  ROLE_PERMISSIONS,
  type PermissionKey,
  type RoleKey,
} from '@coopmanage/shared'
import { API_PREFIX, createApp } from '../src/app.js'
import { disconnectPrisma, prisma } from '../src/lib/prisma.js'
import { registeredRoutes } from '../src/lib/routeRegistry.js'
import '../src/routes.js'
import {
  addStaff,
  cleanupFixtures,
  clearOverrides,
  createCooperative,
  createStaffSession,
  createUser,
  login,
  setOverride,
  type TestCooperative,
} from './fixtures.js'

/**
 * The five testing obligations in docs/permissions.md section 7. They are the reason the
 * permission model can be trusted: each one closes a way the model could be correct on paper and
 * wrong in the running application.
 */
const app = createApp()

let cooperativeA: TestCooperative
let cooperativeB: TestCooperative

beforeAll(async () => {
  cooperativeA = await createCooperative('Abahuzamugambi Coffee')
  cooperativeB = await createCooperative('Koperative Amata Nyagatare')
})

afterAll(async () => {
  await cleanupFixtures()
  await disconnectPrisma()
})

// ---------------------------------------------------------------------------
// 1. Matrix test
// ---------------------------------------------------------------------------

const DOC_COLUMN_TO_ROLE: Record<string, RoleKey> = {
  Manager: 'MANAGER',
  Accountant: 'ACCOUNTANT',
  Secretary: 'SECRETARY',
  'Inventory officer': 'INVENTORY_OFFICER',
  Viewer: 'VIEWER',
}

/**
 * Reads the matrix out of `docs/permissions.md` rather than restating it here. A table nobody
 * checks drifts from the code within a phase or two; reading it makes the document the test.
 */
function matrixFromDocumentation(): Map<RoleKey, Set<PermissionKey>> {
  const path = fileURLToPath(new URL('../../../docs/permissions.md', import.meta.url))
  const lines = readFileSync(path, 'utf8').split('\n')
  const start = lines.findIndex((line) => line.startsWith('## 3. Role matrix'))
  if (start === -1) throw new Error('docs/permissions.md no longer has a "3. Role matrix" section')

  const header = lines.slice(start).find((line) => line.trimStart().startsWith('| Permission'))
  if (!header) throw new Error('the role matrix table could not be found')

  const columns = header
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim())
  const roleByIndex = columns.map((label) => DOC_COLUMN_TO_ROLE[label])

  const matrix = new Map<RoleKey, Set<PermissionKey>>(
    Object.values(DOC_COLUMN_TO_ROLE).map((role) => [role, new Set<PermissionKey>()]),
  )

  for (const line of lines.slice(lines.indexOf(header) + 2)) {
    if (!line.trimStart().startsWith('|')) break
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    const key = cells[0] as PermissionKey
    if (!(COOPERATIVE_PERMISSIONS as readonly string[]).includes(key)) continue
    cells.forEach((cell, index) => {
      const role = roleByIndex[index]
      if (role && cell === '●') matrix.get(role)?.add(key)
    })
  }
  return matrix
}

describe('1. matrix test', () => {
  const documented = matrixFromDocumentation()

  it('reads every cooperative permission out of the documented matrix', () => {
    const listed = new Set<PermissionKey>()
    for (const keys of documented.values()) for (const key of keys) listed.add(key)
    // A permission absent from every row would make a missing row look like a deliberate denial.
    const missing = COOPERATIVE_PERMISSIONS.filter((key) => !listed.has(key))
    expect(missing, `not in the documented matrix: ${missing.join(', ')}`).toEqual([])
  })

  for (const [roleKey, documentedKeys] of documented) {
    it(`grants ${roleKey} exactly what the documentation says`, () => {
      expect([...ROLE_PERMISSIONS[roleKey]].sort()).toEqual([...documentedKeys].sort())
    })

    it(`seeds ${roleKey} with exactly the same set`, async () => {
      const rows = await prisma.rolePermission.findMany({
        where: { role: { key: roleKey } },
        select: { permission: { select: { key: true } } },
      })
      expect(rows.map((row) => row.permission.key).sort()).toEqual([...documentedKeys].sort())
    })
  }

  it('gives the system administrator no way to post a cooperative’s transactions', () => {
    const platformAdmin = new Set<string>(ROLE_PERMISSIONS.SYSTEM_ADMIN)
    for (const forbidden of [
      'finance:create',
      'finance:void',
      'inventory:receive',
      'sales:create',
      'documents:view',
    ]) {
      expect(platformAdmin.has(forbidden), `SYSTEM_ADMIN must not hold ${forbidden}`).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Route inventory test
// ---------------------------------------------------------------------------

describe('2. route inventory test', () => {
  const routes = registeredRoutes()

  it('declares an access requirement on every route', () => {
    for (const route of routes) {
      expect(['PUBLIC', 'AUTHENTICATED', 'PERMISSION']).toContain(route.access.kind)
    }
  })

  it('refuses every non-public route without a session', async () => {
    for (const route of routes.filter((candidate) => candidate.access.kind !== 'PUBLIC')) {
      const path = `${API_PREFIX}${route.path.replace(/:\w+/g, '00000000-0000-4000-8000-000000000000')}`
      const res = await request(app)[methodOf(route.method)](path)
      expect(res.status, `${route.method} ${route.path} let an anonymous caller through`).toBe(401)
    }
  })

  it('names every permission a route declares in the shared catalogue', () => {
    const catalogue = new Set<string>(ALL_PERMISSIONS)
    for (const route of routes) {
      if (route.access.kind !== 'PERMISSION') continue
      expect(
        catalogue.has(route.access.permission),
        `${route.path} declares ${route.access.permission}, which is not in the catalogue`,
      ).toBe(true)
    }
  })

  /**
   * Scope has to match the namespace. A cooperative route guarded by a `platform:*` key would be
   * unreachable by any staff role, and a platform route guarded by a cooperative key would be
   * reachable by ordinary staff — which is the more dangerous of the two mistakes.
   */
  it('guards cooperative routes with cooperative permissions and platform routes with platform ones', () => {
    const cooperativeKeys = new Set<string>(COOPERATIVE_PERMISSIONS)
    for (const route of routes) {
      if (route.access.kind !== 'PERMISSION') continue
      const isPlatformPath = route.path.startsWith('/admin')
      const isPlatformKey = route.access.permission.startsWith('platform:')

      expect(
        isPlatformKey,
        `${route.path} is ${isPlatformPath ? 'a platform' : 'a cooperative'} route but declares ${route.access.permission}`,
      ).toBe(isPlatformPath)
      if (!isPlatformPath) {
        expect(cooperativeKeys.has(route.access.permission)).toBe(true)
      }
    }
  })
})

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
function methodOf(method: Method): 'get' | 'post' | 'patch' | 'put' | 'delete' {
  return method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete'
}

// ---------------------------------------------------------------------------
// 3. Cross-tenant test
// ---------------------------------------------------------------------------

describe('3. cross-tenant test', () => {
  /**
   * The sweep is derived from the registry rather than from a hand-kept list, so a route added in
   * a later phase is covered the moment it is registered and cannot be forgotten.
   */
  /**
   * Cooperative-scoped routes only. The `/admin` surface carries no tenant at all and is swept
   * separately in `tenancy.test.ts`, where a caller who is not a platform administrator is
   * expected to get 404 rather than 403.
   */
  const tenantRoutes = registeredRoutes().filter(
    (route) => route.access.kind === 'PERMISSION' && !route.path.startsWith('/admin'),
  )

  it('has tenant-scoped routes to sweep', () => {
    expect(tenantRoutes.length).toBeGreaterThan(0)
  })

  it('refuses every tenant-scoped route when the caller is not staff of that cooperative', async () => {
    const staffOfA = await createStaffSession(app, cooperativeA, 'MANAGER')

    for (const route of tenantRoutes) {
      const path = `${API_PREFIX}${route.path.replace(/:\w+/g, '00000000-0000-4000-8000-000000000000')}`
      const res = await request(app)
        [methodOf(route.method)](path)
        .set('Authorization', `Bearer ${staffOfA.accessToken}`)
        .set('X-Cooperative-Id', cooperativeB.id)

      expect(res.status, `${route.method} ${route.path} reached another cooperative`).toBe(403)
      expect(res.body.error.code).toBe('NO_COOPERATIVE_ACCESS')
    }
  })

  it('refuses a cooperative id that does not exist, without saying so', async () => {
    const staffOfA = await createStaffSession(app, cooperativeA, 'MANAGER')
    const res = await request(app)
      .get(`${API_PREFIX}/audit`)
      .set('Authorization', `Bearer ${staffOfA.accessToken}`)
      .set('X-Cooperative-Id', '00000000-0000-4000-8000-000000000000')
      .expect(403)
    // The same answer as "you are not staff there": an id that exists and one that does not must
    // be indistinguishable, or the header becomes a way to enumerate cooperatives.
    expect(res.body.error.code).toBe('NO_COOPERATIVE_ACCESS')
  })

  it('refuses a caller whose membership has been deactivated', async () => {
    const user = await createUser()
    const { staffId } = await addStaff(cooperativeA.id, user.id, 'MANAGER')
    const session = await login(app, user)

    await request(app)
      .get(`${API_PREFIX}/audit`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('X-Cooperative-Id', cooperativeA.id)
      .expect(200)

    await prisma.cooperativeStaff.update({
      where: { id: staffId },
      data: { status: 'INACTIVE', deactivatedAt: new Date() },
    })

    await request(app)
      .get(`${API_PREFIX}/audit`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('X-Cooperative-Id', cooperativeA.id)
      .expect(403)
  })

  it('keeps one cooperative’s audit entries out of another’s log', async () => {
    const managerA = await createStaffSession(app, cooperativeA, 'MANAGER')
    const managerB = await createStaffSession(app, cooperativeB, 'MANAGER')

    await prisma.auditLog.create({
      data: {
        cooperativeId: cooperativeB.id,
        actorLabel: 'seeded for the isolation test',
        action: 'member.created',
        entityType: 'Member',
        messageKey: 'audit.member.created',
      },
    })

    const seenByA = await request(app)
      .get(`${API_PREFIX}/audit`)
      .set('Authorization', `Bearer ${managerA.accessToken}`)
      .set('X-Cooperative-Id', cooperativeA.id)
      .expect(200)
    expect(
      seenByA.body.data.some((row: { action: string }) => row.action === 'member.created'),
    ).toBe(false)

    const seenByB = await request(app)
      .get(`${API_PREFIX}/audit`)
      .set('Authorization', `Bearer ${managerB.accessToken}`)
      .set('X-Cooperative-Id', cooperativeB.id)
      .expect(200)
    expect(
      seenByB.body.data.some((row: { action: string }) => row.action === 'member.created'),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4. Negative role tests
// ---------------------------------------------------------------------------

describe('4. negative role tests', () => {
  const rolesWithoutAudit: RoleKey[] = ['ACCOUNTANT', 'SECRETARY', 'INVENTORY_OFFICER', 'VIEWER']

  for (const roleKey of rolesWithoutAudit) {
    it(`refuses ${roleKey} the audit log with FORBIDDEN`, async () => {
      const staff = await createStaffSession(app, cooperativeA, roleKey)
      const res = await request(app)
        .get(`${API_PREFIX}/audit`)
        .set('Authorization', `Bearer ${staff.accessToken}`)
        .set('X-Cooperative-Id', cooperativeA.id)
        .expect(403)

      expect(res.body.error.code).toBe('FORBIDDEN')
      expect(res.body.error.messageParams.permission).toBe('audit:view')
    })
  }

  it('allows the manager, who holds the permission', async () => {
    const manager = await createStaffSession(app, cooperativeA, 'MANAGER')
    await request(app)
      .get(`${API_PREFIX}/audit`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set('X-Cooperative-Id', cooperativeA.id)
      .expect(200)
  })

  it('reports the permission it wanted, so the interface can explain the refusal', async () => {
    const viewer = await createStaffSession(app, cooperativeA, 'VIEWER')
    const res = await request(app)
      .get(`${API_PREFIX}/audit`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .set('X-Cooperative-Id', cooperativeA.id)
      .expect(403)
    expect(res.body.error.messageKey).toBe('errors.forbidden')
  })
})

// ---------------------------------------------------------------------------
// 5. Override test
// ---------------------------------------------------------------------------

describe('5. override test', () => {
  it('a GRANT adds access the role does not carry', async () => {
    const viewer = await createStaffSession(app, cooperativeA, 'VIEWER')

    await request(app)
      .get(`${API_PREFIX}/audit`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .set('X-Cooperative-Id', cooperativeA.id)
      .expect(403)

    await setOverride(viewer.staffId, 'audit:view', 'GRANT')

    await request(app)
      .get(`${API_PREFIX}/audit`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .set('X-Cooperative-Id', cooperativeA.id)
      .expect(200)
  })

  it('a DENY removes access the role does carry', async () => {
    const manager = await createStaffSession(app, cooperativeA, 'MANAGER')

    await request(app)
      .get(`${API_PREFIX}/audit`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set('X-Cooperative-Id', cooperativeA.id)
      .expect(200)

    await setOverride(manager.staffId, 'audit:view', 'DENY')

    const res = await request(app)
      .get(`${API_PREFIX}/audit`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .set('X-Cooperative-Id', cooperativeA.id)
      .expect(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('a DENY wins over a GRANT for the same permission', async () => {
    const viewer = await createStaffSession(app, cooperativeA, 'VIEWER')
    await setOverride(viewer.staffId, 'audit:view', 'GRANT')
    await setOverride(viewer.staffId, 'audit:view', 'DENY')

    await request(app)
      .get(`${API_PREFIX}/audit`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .set('X-Cooperative-Id', cooperativeA.id)
      .expect(403)
  })

  it('reflects the change in the permission set the interface is given', async () => {
    const viewer = await createStaffSession(app, cooperativeA, 'VIEWER')
    await setOverride(viewer.staffId, 'audit:view', 'GRANT')

    const granted = await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .set('X-Cooperative-Id', cooperativeA.id)
      .expect(200)
    expect(granted.body.data.permissions).toContain('audit:view')

    await clearOverrides(viewer.staffId)

    const revoked = await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .set('X-Cooperative-Id', cooperativeA.id)
      .expect(200)
    expect(revoked.body.data.permissions).not.toContain('audit:view')
  })
})

// ---------------------------------------------------------------------------
// Platform administration
// ---------------------------------------------------------------------------

describe('platform administrator', () => {
  it('may act in a cooperative without a membership, with the system administrator’s set', async () => {
    const admin = await createUser({ isPlatformAdmin: true, fullName: 'Platform operator' })
    const session = await login(app, admin)

    const res = await request(app)
      .get(`${API_PREFIX}/auth/me`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('X-Cooperative-Id', cooperativeA.id)
      .expect(200)

    expect(res.body.data.roleKey).toBe('SYSTEM_ADMIN')
    expect(res.body.data.permissions).toContain('audit:view')
    expect(res.body.data.permissions).not.toContain('finance:create')
    // No membership row, so the cooperative does not appear in their own list.
    expect(res.body.data.memberships).toEqual([])
  })

  it('writes every such request to the audit trail', async () => {
    const admin = await createUser({ isPlatformAdmin: true, fullName: 'Platform operator' })
    const session = await login(app, admin)

    await request(app)
      .get(`${API_PREFIX}/audit`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('X-Cooperative-Id', cooperativeA.id)
      .expect(200)

    const entry = await prisma.auditLog.findFirst({
      where: { actorUserId: admin.id, action: 'platform.tenant_access' },
      select: { cooperativeId: true, messageParams: true },
    })
    expect(entry?.cooperativeId).toBe(cooperativeA.id)
    expect((entry?.messageParams as { path: string }).path).toContain('/audit')
  })
})
