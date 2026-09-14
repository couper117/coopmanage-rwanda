import { afterAll, beforeAll } from 'vitest'
import { closeServers, serversReady } from './server.js'

/**
 * Runs for every test file. The listeners are created when the file is imported, which happens
 * before these hooks, so this only has to wait for them to be bound and shut them down at the end.
 */
beforeAll(async () => {
  await serversReady()
})

afterAll(async () => {
  await closeServers()
})
