import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { createApp } from '../src/app.js'

/**
 * One HTTP listener per test file.
 *
 * Supertest's `request(app)` binds a fresh ephemeral port for every single request and closes it
 * once the response arrives. With one file that is invisible; with thirteen files in parallel
 * worker processes it is thousands of bind/close cycles a second against the same ephemeral
 * range, and connections start arriving at the wrong process. A probe of six workers each making
 * 1500 requests to the public `/health` route produced a 401, which only exists on another
 * route — the connection had been delivered to a different worker's server.
 *
 * That was the source of the scattered, unreproducible failures across the suite: a 403 where a
 * 401 belonged, a 400 in place of a 409, an occasional socket hang up, each in a different file
 * on each run. Holding one listener open for the lifetime of the file removes the churn: supertest
 * only starts a server of its own when the one it is handed has no address yet, and only closes
 * the one it started.
 */
const servers = new Set<Server>()

/** Call once at module scope, in place of `createApp()`, and hand the result to supertest. */
export function testApp(): Server {
  const server = createServer(createApp())
  // Keep-alive sockets would hold the process open past the last test.
  server.unref()
  server.listen(0, '127.0.0.1')
  servers.add(server)
  return server
}

/** Awaited by the global setup before any test runs, so every listener has an address. */
export async function serversReady(): Promise<void> {
  await Promise.all(
    [...servers].map(async (server) => {
      if (server.address()) return
      await once(server, 'listening')
    }),
  )
}

export async function closeServers(): Promise<void> {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
  servers.clear()
}
