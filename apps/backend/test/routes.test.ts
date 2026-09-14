import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { API_PREFIX } from '../src/app.js'
import { testApp } from './server.js'
import { disconnectPrisma } from '../src/lib/prisma.js'
import { registeredRoutes } from '../src/lib/routeRegistry.js'
// Importing the router populates the registry as a side effect of module loading.
import '../src/routes.js'

const app = testApp()

afterAll(async () => {
  await disconnectPrisma()
})

/**
 * The route inventory. Phase 1 asserts that the recorded surface is real and that every public
 * route was declared public deliberately. Phase 2 extends this to assert that every route which is
 * not public resolves a session and a permission.
 */
describe('route inventory', () => {
  const routes = registeredRoutes()

  it('records every route the application exposes', () => {
    expect(routes.length).toBeGreaterThan(0)
    const paths = routes.map((route) => `${route.method} ${route.path}`)
    expect(paths).toContain('GET /health')
    expect(paths).toContain('GET /health/ready')
    expect(paths).toContain('GET /cooperative-types')
    expect(paths).toContain('POST /auth/login')
    expect(paths).toContain('GET /auth/me')
    expect(paths).toContain('GET /audit')
  })

  it('declares an access requirement for every route', () => {
    for (const route of routes) {
      expect(route.access.kind, `${route.method} ${route.path}`).toBeDefined()
    }
  })

  it('keeps the public surface to the routes that genuinely need it', () => {
    const publicPaths = routes
      .filter((route) => route.access.kind === 'PUBLIC')
      .map((route) => `${route.method} ${route.path}`)
      .sort()
    // Growing this list is a deliberate security decision, so the test names it explicitly.
    // Every authentication route on this list is how a session begins or is recovered, and each is
    // rate limited by IP and by account. `/auth/refresh` and `/auth/logout` authenticate with the
    // refresh cookie rather than a bearer token, and check the request origin.
    expect(publicPaths).toEqual([
      'GET /cooperative-types',
      'GET /health',
      'GET /health/ready',
      'POST /auth/forgot-password',
      'POST /auth/login',
      'POST /auth/logout',
      'POST /auth/refresh',
      'POST /auth/reset-password',
    ])
  })

  it('registers no duplicate route', () => {
    const paths = routes.map((route) => `${route.method} ${route.path}`)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('records paths that the running application actually serves', async () => {
    // Guards against a router being mounted at a different path from the one it recorded. A
    // protected route answers 401 here rather than 200, which is still proof that it is mounted.
    for (const route of routes.filter((candidate) => candidate.method === 'GET')) {
      const path = route.path.replace(/:\w+/g, '00000000-0000-4000-8000-000000000000')
      const res = await request(app).get(`${API_PREFIX}${path}`)
      expect(res.status, `${route.method} ${route.path} is recorded but not reachable`).not.toBe(
        404,
      )
    }
  })
})
