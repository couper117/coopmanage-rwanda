import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { API_PREFIX, createApp } from '../src/app.js'
import { disconnectPrisma } from '../src/lib/prisma.js'

const app = createApp()

afterAll(async () => {
  await disconnectPrisma()
})

describe('health', () => {
  it('reports liveness without touching the database', async () => {
    const res = await request(app).get(`${API_PREFIX}/health`)
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('ok')
    expect(res.body.data.environment).toBe('test')
  })

  it('reports readiness with database latency', async () => {
    const res = await request(app).get(`${API_PREFIX}/health/ready`)
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('ready')
    expect(res.body.data.checks.database.reachable).toBe(true)
    expect(typeof res.body.data.checks.database.latencyMs).toBe('number')
  })
})

describe('response envelope', () => {
  it('wraps successful payloads in a data property', async () => {
    const res = await request(app).get(`${API_PREFIX}/cooperative-types`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('data')
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it('returns the seeded cooperative types in both languages', async () => {
    const res = await request(app).get(`${API_PREFIX}/cooperative-types`)
    expect(res.body.data).toHaveLength(10)
    const keys = res.body.data.map((row: { key: string }) => row.key)
    expect(keys).toContain('AGRICULTURE')
    expect(keys).toContain('DAIRY')
    for (const row of res.body.data) {
      expect(row.nameEn.length).toBeGreaterThan(0)
      expect(row.nameRw.length).toBeGreaterThan(0)
    }
  })

  it('never leaks internal columns', async () => {
    const res = await request(app).get(`${API_PREFIX}/cooperative-types`)
    expect(res.body.data[0]).not.toHaveProperty('suggestedCategories')
    expect(res.body.data[0]).not.toHaveProperty('createdAt')
  })
})

describe('errors', () => {
  it('returns a translatable envelope for an unknown route', async () => {
    const res = await request(app).get(`${API_PREFIX}/does-not-exist`)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(res.body.error.messageKey).toBe('errors.routeNotFound')
    expect(res.body.error.requestId).toMatch(/^[\w-]+$/)
  })

  it('rejects a malformed JSON body and still carries a request id', async () => {
    const res = await request(app)
      .post(`${API_PREFIX}/does-not-exist`)
      .set('Content-Type', 'application/json')
      .send('{"unclosed":')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.messageKey).toBe('errors.malformedJson')
    expect(res.body.error.requestId).not.toBe('unknown')
  })

  it('never exposes a stack trace to the client', async () => {
    const res = await request(app).get(`${API_PREFIX}/does-not-exist`)
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\(.*\.ts:/)
  })
})

describe('request identity', () => {
  it('generates a request id and echoes it back', async () => {
    const res = await request(app).get(`${API_PREFIX}/health`)
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reuses a caller-supplied request id', async () => {
    const res = await request(app).get(`${API_PREFIX}/health`).set('X-Request-Id', 'trace-abc-123')
    expect(res.headers['x-request-id']).toBe('trace-abc-123')
  })

  it('replaces a malformed request id rather than reflecting it', async () => {
    const res = await request(app)
      .get(`${API_PREFIX}/health`)
      .set('X-Request-Id', '<script>alert(1)</script>')
    expect(res.headers['x-request-id']).not.toContain('script')
  })
})

describe('security headers', () => {
  it('sets the documented headers', async () => {
    const res = await request(app).get(`${API_PREFIX}/health`)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(res.headers['content-security-policy']).toContain("object-src 'none'")
  })

  it('does not advertise the server framework', async () => {
    const res = await request(app).get(`${API_PREFIX}/health`)
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})
