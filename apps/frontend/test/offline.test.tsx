import { QueryClient } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../src/components/ui'
import { ConnectionIndicator } from '../src/components/ConnectionIndicator'
import { clearAllCaches, hydrateCache, persistCache } from '../src/app/persistCache'
import { apiRequest, ApiError } from '../src/lib/apiClient'
import { clearAllDrafts, useFormDraft } from '../src/hooks/useFormDraft'
import { changeLanguage } from '../src/i18n'
import { useConnectionStore } from '../src/stores/connectionStore'
import { resetSession, signInAs } from './session'

/**
 * Phase 13 — what happens when the connection is not there.
 *
 * The exit criterion is one sentence with two halves: with the network disabled mid-form, **no
 * input is lost** and **no duplicate financial record is created** when the connection returns.
 * Both halves are checked here, and the second is the one that could cost a cooperative money.
 *
 * The rule the second half rests on is short: a request is repeated only if it is a `GET` or it
 * carries an idempotency key. A contribution of 7,500 francs posted without one is sent exactly
 * once, whatever the network does, because there is no cleverness available — either the server can
 * recognise a repeat or the client must not make one.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function resetConnection(): void {
  useConnectionStore.setState({ browserOnline: true, serverReachable: true, lastReachedAt: null })
}

beforeEach(() => {
  signInAs('MANAGER')
  resetConnection()
  clearAllCaches()
  clearAllDrafts()
  window.localStorage.clear()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  resetSession()
  resetConnection()
  await changeLanguage('en')
})

describe('repeating a request', () => {
  it('repeats a GET that reached nothing, and reports what happened', async () => {
    let attempts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        attempts += 1
        if (attempts < 3) return Promise.reject(new TypeError('Failed to fetch'))
        return Promise.resolve(jsonResponse({ data: { ok: true } }))
      }),
    )

    // A read changes nothing, so a repeat costs a little traffic and saves the reader a failure
    // they would have had to act on.
    await expect(apiRequest('/members/stats')).resolves.toEqual({ ok: true })
    expect(attempts).toBe(3)
  }, 10_000)

  it('sends a mutation with no idempotency key exactly once', async () => {
    let attempts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        attempts += 1
        return Promise.reject(new TypeError('Failed to fetch'))
      }),
    )

    // The case that matters. A repeat of an unkeyed write could be a second contribution of the
    // same money, and nothing at the far end would be able to tell.
    await expect(
      apiRequest('/members/mem-1/contributions', {
        method: 'POST',
        body: { type: 'SAVINGS', amount: '7500' },
      }),
    ).rejects.toBeInstanceOf(ApiError)
    expect(attempts).toBe(1)
  })

  it('repeats a mutation that carries an idempotency key', async () => {
    let attempts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        attempts += 1
        if (attempts < 2) return Promise.reject(new TypeError('Failed to fetch'))
        return Promise.resolve(jsonResponse({ data: { id: 'fin-1' } }))
      }),
    )

    // Safe, because the server recognises the key and answers with the first attempt's result
    // rather than doing the work twice.
    await expect(
      apiRequest('/finance/transactions', {
        method: 'POST',
        body: { amount: '7500' },
        idempotencyKey: 'key-1',
      }),
    ).resolves.toEqual({ id: 'fin-1' })
    expect(attempts).toBe(2)
  }, 10_000)

  it('waits out a gateway that is restarting, on a repeatable request only', async () => {
    let attempts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        attempts += 1
        if (attempts < 2) return Promise.resolve(jsonResponse({ error: {} }, 503))
        return Promise.resolve(jsonResponse({ data: [] }))
      }),
    )

    await expect(apiRequest('/members')).resolves.toEqual([])
    expect(attempts).toBe(2)
  }, 10_000)

  it('reports a 503 on an unkeyed write rather than trying again', async () => {
    let attempts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        attempts += 1
        return Promise.resolve(jsonResponse({ error: { code: 'UNAVAILABLE' } }, 503))
      }),
    )

    await expect(apiRequest('/members', { method: 'POST', body: {} })).rejects.toBeInstanceOf(
      ApiError,
    )
    expect(attempts).toBe(1)
  })
})

describe('what the indicator says', () => {
  it('distinguishes no network from a server that is not answering', async () => {
    render(
      <TooltipProvider>
        <ConnectionIndicator />
      </TooltipProvider>,
    )
    expect(screen.getByText('Connected')).toBeInTheDocument()

    // The commoner case in a district office: the office wifi is fine and the link out is down.
    act(() => useConnectionStore.getState().reportUnreachable())
    await waitFor(() => expect(screen.getByText('Cannot reach the server')).toBeInTheDocument())

    act(() => useConnectionStore.getState().setBrowserOnline(false))
    await waitFor(() => expect(screen.getByText('No connection')).toBeInTheDocument())

    act(() => {
      useConnectionStore.getState().setBrowserOnline(true)
      useConnectionStore.getState().reportReached()
    })
    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument())
  })

  it('is set by what happened to the last request, not by the browser alone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )

    await expect(apiRequest('/members', { method: 'POST', body: {} })).rejects.toBeInstanceOf(
      ApiError,
    )

    // `navigator.onLine` is still true — it usually is — and the state is `unreachable` because
    // the request is what actually knows.
    expect(useConnectionStore.getState().browserOnline).toBe(true)
    expect(useConnectionStore.getState().serverReachable).toBe(false)
  })

  it('goes back to reachable on any answer, including a refusal', async () => {
    useConnectionStore.getState().reportUnreachable()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ error: {} }, 422))),
    )

    await expect(apiRequest('/members', { method: 'POST', body: {} })).rejects.toBeInstanceOf(
      ApiError,
    )
    // A 422 is an answer. Treating it as a connection failure would tell a reader their network is
    // broken when in fact their form is.
    expect(useConnectionStore.getState().serverReachable).toBe(true)
  })
})

describe('what was typed, kept across a reload', () => {
  const session = { cooperativeId: 'coop-1', form: 'sale' as const }

  it('offers a stored draft rather than applying it', () => {
    const first = renderHook(() => useFormDraft<{ note: string }>(session))
    act(() => first.result.current.save({ note: 'eleven bags of maize' }))
    first.unmount()

    // A new mount is what a reload is. The draft is found and offered — never silently filled in,
    // because a form that quietly holds yesterday's half-typed entry gets submitted unread.
    const second = renderHook(() => useFormDraft<{ note: string }>(session))
    expect(second.result.current.offered).toEqual({ note: 'eleven bags of maize' })
  })

  it("keeps one cooperative's draft away from another", () => {
    const mine = renderHook(() => useFormDraft<{ note: string }>(session))
    act(() => mine.result.current.save({ note: 'my half-written sale' }))
    mine.unmount()

    const theirs = renderHook(() =>
      useFormDraft<{ note: string }>({ ...session, cooperativeId: 'coop-2' }),
    )
    expect(theirs.result.current.offered).toBeNull()
  })

  it('keeps drafts of different records apart', () => {
    const one = renderHook(() => useFormDraft<{ note: string }>({ ...session, recordId: 'sale-1' }))
    act(() => one.result.current.save({ note: 'for sale one' }))
    one.unmount()

    const two = renderHook(() => useFormDraft<{ note: string }>({ ...session, recordId: 'sale-2' }))
    expect(two.result.current.offered).toBeNull()
  })

  it('forgets a draft once the record is saved', () => {
    const first = renderHook(() => useFormDraft<{ note: string }>(session))
    act(() => first.result.current.save({ note: 'about to be recorded' }))
    act(() => first.result.current.clear())
    first.unmount()

    const second = renderHook(() => useFormDraft<{ note: string }>(session))
    expect(second.result.current.offered).toBeNull()
  })

  it('discards one older than a day, because nobody is in the middle of last week', () => {
    const key = 'coopmanage.draft:coop-1:sale:new'
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000
    window.localStorage.setItem(
      key,
      JSON.stringify({ savedAt: twoDaysAgo, values: { note: 'last week' } }),
    )

    const { result } = renderHook(() => useFormDraft<{ note: string }>(session))
    expect(result.current.offered).toBeNull()
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it('writes nothing while the form is closed', () => {
    const { result } = renderHook(() =>
      useFormDraft<{ note: string }>({ ...session, enabled: false }),
    )
    act(() => result.current.save({ note: 'should not be stored' }))
    expect(window.localStorage.length).toBe(0)
  })
})

describe('the last-seen data, kept across a reload', () => {
  const session = { userId: 'user-1', cooperativeId: 'coop-1' }

  function clientWithData(): QueryClient {
    const client = new QueryClient()
    client.setQueryData(['members', 'coop-1', 'list'], { items: [{ id: 'mem-1' }] })
    return client
  }

  it('puts back what the reader last saw', async () => {
    const saving = clientWithData()
    const stop = persistCache(saving, session, 0)
    // The subscription fires on the next cache change, which is what a real fetch would cause.
    saving.setQueryData(['members', 'coop-1', 'stats'], { total: 120 })
    await waitFor(() => expect(window.localStorage.length).toBeGreaterThan(0))
    stop()

    const fresh = new QueryClient()
    expect(hydrateCache(fresh, session)).toBe(true)
    expect(fresh.getQueryData(['members', 'coop-1', 'list'])).toEqual({
      items: [{ id: 'mem-1' }],
    })
  })

  it("does not hydrate one person's cache into another's session", async () => {
    const saving = clientWithData()
    const stop = persistCache(saving, session, 0)
    saving.setQueryData(['members', 'coop-1', 'stats'], { total: 120 })
    await waitFor(() => expect(window.localStorage.length).toBeGreaterThan(0))
    stop()

    // A shared office computer. The next person signs in and must see nothing of the last.
    const fresh = new QueryClient()
    expect(hydrateCache(fresh, { userId: 'user-2', cooperativeId: 'coop-1' })).toBe(false)
    expect(fresh.getQueryData(['members', 'coop-1', 'list'])).toBeUndefined()
  })

  it('discards a cache older than a day', async () => {
    const saving = clientWithData()
    const stop = persistCache(saving, session, 0)
    saving.setQueryData(['members', 'coop-1', 'stats'], { total: 120 })
    await waitFor(() => expect(window.localStorage.length).toBeGreaterThan(0))
    stop()

    const tomorrowPlus = Date.now() + 25 * 60 * 60 * 1000
    const fresh = new QueryClient()
    expect(hydrateCache(fresh, session, tomorrowPlus)).toBe(false)
  })

  it('leaves nothing behind when the cooperative signs out', async () => {
    const saving = clientWithData()
    const stop = persistCache(saving, session, 0)
    saving.setQueryData(['members', 'coop-1', 'stats'], { total: 120 })
    await waitFor(() => expect(window.localStorage.length).toBeGreaterThan(0))
    stop()

    clearAllCaches()
    // Every key, not only the current one: the point is that a shared machine is left clean.
    expect(window.localStorage.length).toBe(0)
  })
})
