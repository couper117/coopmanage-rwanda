import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreSession } from '../src/features/auth/useSession'
import { useAuthStore } from '../src/stores/authStore'
import { resetSession } from './session'

/**
 * Restoring a session exchanges the refresh cookie for an access token. Presenting a refresh token
 * twice is how the server detects a stolen one, and it answers by revoking the whole family — so a
 * second concurrent restore would not merely be wasteful, it would sign the user out. React's
 * development StrictMode double-invokes effects, which makes this a race that happens on every
 * single page load rather than a theoretical one.
 */
describe('restoring a session', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    resetSession()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exchanges the cookie exactly once when called twice at the same moment', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { accessToken: 'a-fresh-token' } }),
    })

    await Promise.all([restoreSession(), restoreSession()])

    const refreshCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).endsWith('/auth/refresh'),
    )
    expect(refreshCalls).toHaveLength(1)
  })

  it('settles as anonymous when there is no usable cookie', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) })

    await restoreSession()

    expect(useAuthStore.getState().status).toBe('anonymous')
    expect(useAuthStore.getState().accessToken).toBeNull()
  })

  it('does not leave a user looking signed in when the server cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await restoreSession()

    expect(useAuthStore.getState().status).toBe('anonymous')
  })

  it('starts a fresh attempt after the first one has finished', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) })

    await restoreSession()
    await restoreSession()

    expect(fetchMock.mock.calls.length).toBe(2)
  })
})
