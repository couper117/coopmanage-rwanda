import { afterAll, beforeAll } from 'vitest'
import { startRecording, stopRecording } from './routeCoverage.js'
import { closeServers, serversReady } from './server.js'

/**
 * Runs for every test file. The listeners are created when the file is imported, which happens
 * before these hooks, so this only has to wait for them to be bound and shut them down at the end.
 *
 * Every response a registered route sends during the file is recorded, so the global teardown can
 * prove that each endpoint has a test — `routeCoverage.ts` explains.
 */
beforeAll(async () => {
  startRecording()
  await serversReady()
})

afterAll(async () => {
  stopRecording()
  await closeServers()
})
