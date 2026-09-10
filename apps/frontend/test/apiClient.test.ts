import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiRequest, apiRequestCollection } from '../src/lib/apiClient'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('apiRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('unwraps the data envelope', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { data: { id: 'abc' } }))
    await expect(apiRequest<{ id: string }>('/members/abc')).resolves.toEqual({ id: 'abc' })
  })

  it('sends the language and cooperative headers', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { data: null }))
    await apiRequest('/members', { cooperativeId: 'coop-1' })

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['X-Cooperative-Id']).toBe('coop-1')
    expect(headers['Accept-Language']).toBeDefined()
    expect(init.credentials).toBe('include')
  })

  it('sends an idempotency key when one is given', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(201, { data: null }))
    await apiRequest('/finance/transactions', {
      method: 'POST',
      body: { amount: '1000.00' },
      idempotencyKey: 'key-1',
    })
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('key-1')
  })

  it('builds a query string and drops empty values', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { data: [] }))
    await apiRequest('/members', { query: { q: 'Jean', status: '', page: 2, archived: undefined } })
    const [url] = vi.mocked(fetch).mock.calls[0] as [string]
    expect(url).toContain('q=Jean')
    expect(url).toContain('page=2')
    expect(url).not.toContain('status=')
    expect(url).not.toContain('archived')
  })

  it('returns undefined for a 204 without trying to parse a body', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    await expect(apiRequest('/documents/1/archive', { method: 'POST' })).resolves.toBeUndefined()
  })

  it('turns an error envelope into a translatable ApiError', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(403, {
        error: {
          code: 'FORBIDDEN',
          messageKey: 'errors.forbidden',
          message: 'You do not have permission to do this.',
          requestId: 'req-1',
        },
      }),
    )

    await expect(apiRequest('/finance/transactions')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      messageKey: 'errors.forbidden',
      requestId: 'req-1',
    })
  })

  it('maps field errors onto form field names', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(422, {
        error: {
          code: 'VALIDATION_FAILED',
          messageKey: 'errors.validationFailed',
          message: 'Invalid.',
          requestId: 'req-2',
          details: [
            { field: 'body.amount', messageKey: 'validation.too_small' },
            { field: 'body.member.name', messageKey: 'validation.required' },
          ],
        },
      }),
    )

    try {
      await apiRequest('/finance/transactions', { method: 'POST', body: {} })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).fieldErrors).toEqual({
        amount: 'validation.too_small',
        'member.name': 'validation.required',
      })
    }
  })

  it('reports a network failure as a translatable error, not a raw fetch error', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(apiRequest('/members')).rejects.toMatchObject({
      status: 0,
      messageKey: 'errors.networkUnavailable',
    })
  })

  it('survives an error response that is not JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('<html>502</html>', { status: 502 }))
    await expect(apiRequest('/members')).rejects.toMatchObject({
      status: 502,
      code: 'INTERNAL_ERROR',
    })
  })

  it('reports a 200 that is not our envelope as an error, not a crash', async () => {
    // A proxy or gateway page returned with a success status. Reading `.data` off it used to throw
    // a TypeError, which no error handler in the application recognises.
    // A fresh Response per call: a body can only be read once.
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(new Response('<html>oops</html>', { status: 200 })),
    )
    await expect(apiRequest('/members')).rejects.toBeInstanceOf(ApiError)
    await expect(apiRequest('/members')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      messageKey: 'errors.internal',
    })
  })

  it('reports an empty 200 body as an error rather than returning undefined', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 200 }))
    await expect(apiRequest('/members')).rejects.toBeInstanceOf(ApiError)
  })

  it('reports a JSON 200 with no data property as an error', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { rows: [] }))
    await expect(apiRequest('/members')).rejects.toBeInstanceOf(ApiError)
  })

  it('marks server and rate-limit failures retryable and client errors not', () => {
    const retryable = new ApiError({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      messageKey: 'errors.serviceUnavailable',
      message: '',
    })
    const permanent = new ApiError({
      status: 403,
      code: 'FORBIDDEN',
      messageKey: 'errors.forbidden',
      message: '',
    })
    expect(retryable.isRetryable).toBe(true)
    expect(permanent.isRetryable).toBe(false)
    expect(ApiError.network().isRetryable).toBe(true)
  })

  it('lets an abort propagate rather than reporting it as a network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(apiRequest('/members')).rejects.toBeInstanceOf(DOMException)
  })
})

describe('apiRequestCollection', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the rows and the pagination metadata', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        data: [{ id: '1' }, { id: '2' }],
        meta: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
      }),
    )
    const result = await apiRequestCollection<{ id: string }>('/members')
    expect(result.items).toHaveLength(2)
    expect(result.meta?.total).toBe(2)
  })

  it('honours the abort signal it is given', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { data: [] }))
    const controller = new AbortController()
    await apiRequestCollection('/members', { signal: controller.signal })
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })

  it('sends the cooperative header like every other request', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { data: [] }))
    await apiRequestCollection('/members', { cooperativeId: 'coop-9' })
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['X-Cooperative-Id']).toBe('coop-9')
  })

  it('lets an abort propagate instead of reporting a connection failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(apiRequestCollection('/members')).rejects.toBeInstanceOf(DOMException)
  })
})
