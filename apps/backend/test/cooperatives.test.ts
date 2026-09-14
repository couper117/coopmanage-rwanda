import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HEADERS, OPTIONAL_MODULES } from '@coopmanage/shared'
import { API_PREFIX } from '../src/app.js'
import { testApp } from './server.js'
import { disconnectPrisma, prisma } from '../src/lib/prisma.js'
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

let cooperative: TestCooperative
let manager: TestUser & Session & { staffId: string }
let viewer: TestUser & Session & { staffId: string }

function as(session: Session, method: 'get' | 'patch' | 'put', path: string) {
  return request(app)
    [method](`${API_PREFIX}${path}`)
    .set('Authorization', `Bearer ${session.accessToken}`)
    .set(HEADERS.cooperativeId, cooperative.id)
}

beforeAll(async () => {
  cooperative = await createCooperative('Umurenge Farmers Cooperative')
  manager = await createStaffSession(app, cooperative, 'MANAGER')
  viewer = await createStaffSession(app, cooperative, 'VIEWER')
}, 60_000)

afterAll(async () => {
  await cleanupFixtures()
  await disconnectPrisma()
})

describe('my cooperatives', () => {
  it('lists the cooperatives the caller serves, with their role', async () => {
    const response = await request(app)
      .get(`${API_PREFIX}/cooperatives/mine`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200)

    const mine = response.body.data.find(
      (row: { cooperativeId: string }) => row.cooperativeId === cooperative.id,
    )
    expect(mine.roleKey).toBe('MANAGER')
    expect(mine.name).toBe('Umurenge Farmers Cooperative')
  })

  it('needs no cooperative header, because it is how one is chosen', async () => {
    await request(app)
      .get(`${API_PREFIX}/cooperatives/mine`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200)
  })

  it('returns nothing for a user who serves no cooperative', async () => {
    const stranger = await createUser()
    const session = await login(app, stranger)
    const response = await request(app)
      .get(`${API_PREFIX}/cooperatives/mine`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200)
    expect(response.body.data).toEqual([])
  })

  it('is not a directory of the platform, even for a platform administrator', async () => {
    const admin = await createUser({ isPlatformAdmin: true })
    const session = await login(app, admin)
    const response = await request(app)
      .get(`${API_PREFIX}/cooperatives/mine`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200)
    // They hold no membership, so their switcher is empty. Listing every cooperative is a
    // separate, audited platform endpoint.
    expect(response.body.data).toEqual([])
  })

  it('omits a cooperative the caller was deactivated from', async () => {
    const other = await createCooperative('Left Behind Cooperative')
    const user = await createUser()
    const { staffId } = await addStaff(other.id, user.id, 'VIEWER')
    await prisma.cooperativeStaff.update({ where: { id: staffId }, data: { status: 'INACTIVE' } })

    const session = await login(app, user)
    const response = await request(app)
      .get(`${API_PREFIX}/cooperatives/mine`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200)
    expect(response.body.data).toEqual([])
  })
})

describe('cooperative profile', () => {
  it('returns the profile with its type in both languages', async () => {
    const response = await as(manager, 'get', '/cooperatives/current').expect(200)
    expect(response.body.data.name).toBe('Umurenge Farmers Cooperative')
    expect(response.body.data.type.nameEn.length).toBeGreaterThan(0)
    expect(response.body.data.type.nameRw.length).toBeGreaterThan(0)
    expect(response.body.data.currency).toBe('RWF')
    expect(response.body.data.timezone).toBe('Africa/Kigali')
  })

  it('lets a viewer read it but not change it', async () => {
    await as(viewer, 'get', '/cooperatives/current').expect(200)
    await as(viewer, 'patch', '/cooperatives/current').send({ name: 'Renamed' }).expect(403)
  })

  it('updates the fields it is given and leaves the rest alone', async () => {
    const before = await as(manager, 'get', '/cooperatives/current').expect(200)
    const response = await as(manager, 'patch', '/cooperatives/current')
      .send({ district: 'Musanze', sector: 'Muhoza' })
      .expect(200)

    expect(response.body.data.district).toBe('Musanze')
    expect(response.body.data.sector).toBe('Muhoza')
    expect(response.body.data.name).toBe(before.body.data.name)
  })

  it('normalises a Rwandan phone number', async () => {
    const response = await as(manager, 'patch', '/cooperatives/current')
      .send({ phone: '+250 788 123 456' })
      .expect(200)
    expect(response.body.data.phone).toBe('+250788123456')
  })

  it('refuses a phone number that is not Rwandan', async () => {
    await as(manager, 'patch', '/cooperatives/current').send({ phone: '12345' }).expect(422)
  })

  it('clears an optional field when given an empty string', async () => {
    await as(manager, 'patch', '/cooperatives/current')
      .send({ addressLine: 'KG 11 Ave' })
      .expect(200)
    const response = await as(manager, 'patch', '/cooperatives/current')
      .send({ addressLine: '' })
      .expect(200)
    expect(response.body.data.addressLine).toBeNull()
  })

  it('refuses an empty patch rather than absorbing it', async () => {
    await as(manager, 'patch', '/cooperatives/current').send({}).expect(422)
  })

  it('refuses an unknown field rather than ignoring it', async () => {
    await as(manager, 'patch', '/cooperatives/current')
      .send({ name: 'Fine', sneaky: true })
      .expect(422)
  })

  it('refuses to change the fields that are not the profile', async () => {
    // Status, demo flag, currency and the member-code sequence are not editable here: they are
    // platform decisions or derived counters, and a cooperative renaming itself must not be able
    // to reach them.
    for (const body of [
      { status: 'SUSPENDED' },
      { isDemo: true },
      { currency: 'USD' },
      { memberCodeSequence: 500 },
      { code: 'HIJACKED' },
    ]) {
      await as(manager, 'patch', '/cooperatives/current').send(body).expect(422)
    }
  })

  it('refuses a registration number already held by another cooperative', async () => {
    const other = await createCooperative('Registration Clash Cooperative')
    await prisma.cooperative.update({
      where: { id: other.id },
      data: { registrationNumber: 'RCA-CLASH-001' },
    })

    const response = await as(manager, 'patch', '/cooperatives/current')
      .send({ registrationNumber: 'RCA-CLASH-001' })
      .expect(409)
    expect(response.body.error.code).toBe('DUPLICATE_RESOURCE')
    // The refusal must not say which cooperative holds it.
    expect(JSON.stringify(response.body)).not.toContain('Registration Clash')
  })

  it('records the change in the audit trail with before and after', async () => {
    await as(manager, 'patch', '/cooperatives/current').send({ village: 'Kabeza' }).expect(200)
    const entry = await prisma.auditLog.findFirst({
      where: { cooperativeId: cooperative.id, action: 'cooperative.updated' },
      orderBy: { createdAt: 'desc' },
    })
    expect(entry?.after).toMatchObject({ village: 'Kabeza' })
  })

  it('writes no audit entry when the patch changes nothing', async () => {
    const current = await as(manager, 'get', '/cooperatives/current').expect(200)
    const before = await prisma.auditLog.count({
      where: { cooperativeId: cooperative.id, action: 'cooperative.updated' },
    })
    await as(manager, 'patch', '/cooperatives/current')
      .send({ district: current.body.data.district })
      .expect(200)
    const after = await prisma.auditLog.count({
      where: { cooperativeId: cooperative.id, action: 'cooperative.updated' },
    })
    expect(after).toBe(before)
  })
})

describe('cooperative settings', () => {
  it('returns every setting with its default filled in, before anything is saved', async () => {
    const fresh = await createCooperative('Defaults Cooperative')
    const staff = await createStaffSession(app, fresh, 'MANAGER')
    const response = await request(app)
      .get(`${API_PREFIX}/settings`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .set(HEADERS.cooperativeId, fresh.id)
      .expect(200)

    // A screen reading a setting must not have to know whether anyone has ever saved it.
    expect(response.body.data.enabledModules).toEqual([...OPTIONAL_MODULES])
  })

  it('saves a setting and reads it back', async () => {
    const response = await as(manager, 'put', '/settings/enabledModules')
      .send({ value: ['inventory', 'sales', 'buyers'] })
      .expect(200)
    expect(response.body.data.enabledModules).toEqual(['inventory', 'sales', 'buyers'])

    const read = await as(manager, 'get', '/settings').expect(200)
    expect(read.body.data.enabledModules).toEqual(['inventory', 'sales', 'buyers'])
  })

  it('accepts an empty list, which switches every optional module off', async () => {
    const response = await as(manager, 'put', '/settings/enabledModules')
      .send({ value: [] })
      .expect(200)
    expect(response.body.data.enabledModules).toEqual([])
  })

  it('refuses a key that is not in the catalogue', async () => {
    await as(manager, 'put', '/settings/somethingElse').send({ value: true }).expect(422)
  })

  it('refuses a value of the wrong shape for its key', async () => {
    await as(manager, 'put', '/settings/enabledModules').send({ value: 'inventory' }).expect(422)
    await as(manager, 'put', '/settings/enabledModules')
      .send({ value: ['nonsense'] })
      .expect(422)
  })

  it('refuses a core module in the optional list, because it cannot be switched off', async () => {
    await as(manager, 'put', '/settings/enabledModules')
      .send({ value: ['members'] })
      .expect(422)
  })

  it('lets a viewer read settings but not write them', async () => {
    await as(viewer, 'get', '/settings').expect(200)
    await as(viewer, 'put', '/settings/enabledModules').send({ value: [] }).expect(403)
  })

  it('records who changed a setting', async () => {
    await as(manager, 'put', '/settings/enabledModules')
      .send({ value: ['documents'] })
      .expect(200)

    const row = await prisma.cooperativeSetting.findFirstOrThrow({
      where: { cooperativeId: cooperative.id, key: 'enabledModules' },
      select: { updatedById: true },
    })
    expect(row.updatedById).toBe(manager.id)

    const entry = await prisma.auditLog.findFirst({
      where: { cooperativeId: cooperative.id, action: 'cooperative.setting.updated' },
      orderBy: { createdAt: 'desc' },
    })
    expect(entry?.messageParams).toMatchObject({ key: 'enabledModules' })
  })
})
