import type { ApiErrorBody, ApiResponse, ErrorCode, MessageParams } from '@coopmanage/shared'
import { HEADERS } from '@coopmanage/shared'
import { currentLanguage } from '@/i18n'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

/**
 * The error every failed request produces, whatever went wrong. It always carries a translation
 * key so the interface can show a sentence in the user's language, and it never carries a stack
 * trace or a raw server message into the interface.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly messageKey: string
  readonly messageParams: MessageParams | undefined
  readonly fieldErrors: Record<string, string>
  readonly requestId: string | undefined

  constructor(init: {
    status: number
    code: ErrorCode
    messageKey: string
    messageParams?: MessageParams
    message: string
    fieldErrors?: Record<string, string>
    requestId?: string
  }) {
    super(init.message)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.messageKey = init.messageKey
    this.messageParams = init.messageParams
    this.fieldErrors = init.fieldErrors ?? {}
    this.requestId = init.requestId
  }

  /** True when retrying the same request could reasonably succeed. */
  get isRetryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500
  }

  static network(): ApiError {
    return new ApiError({
      status: 0,
      code: 'SERVICE_UNAVAILABLE',
      messageKey: 'errors.networkUnavailable',
      message: 'Could not reach the server.',
    })
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** Sent as X-Cooperative-Id. Every tenant-scoped request needs it from Phase 3. */
  cooperativeId?: string
  /** Sent as Idempotency-Key on money and stock mutations, so a retry cannot duplicate a record. */
  idempotencyKey?: string
  signal?: AbortSignal
  query?: Record<string, string | number | boolean | undefined | null>
}

function buildUrl(path: string, query: RequestOptions['query']): string {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const queryString = params.toString()
  return queryString ? `${url}?${queryString}` : url
}

function toApiError(status: number, payload: unknown): ApiError {
  const body = (payload as { error?: ApiErrorBody } | null)?.error
  if (!body) {
    return new ApiError({
      status,
      code: 'INTERNAL_ERROR',
      messageKey: 'errors.internal',
      message: `Request failed with status ${status}.`,
    })
  }

  const fieldErrors: Record<string, string> = {}
  for (const detail of body.details ?? []) {
    // Strip the `body.` / `query.` source prefix so the key matches the form field name.
    const field = detail.field.replace(/^(body|query|params)\./, '')
    fieldErrors[field] = detail.messageKey
  }

  return new ApiError({
    status,
    code: body.code,
    messageKey: body.messageKey,
    ...(body.messageParams ? { messageParams: body.messageParams } : {}),
    message: body.message,
    fieldErrors,
    ...(body.requestId ? { requestId: body.requestId } : {}),
  })
}

/**
 * The single place a network request is made. Everything else goes through a feature's query hook,
 * which goes through here, so headers, error shape and language handling cannot drift.
 */
export async function apiRequest<TData>(
  path: string,
  options: RequestOptions = {},
): Promise<TData> {
  const { method = 'GET', body, cooperativeId, idempotencyKey, signal, query } = options

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Language': currentLanguage(),
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (cooperativeId) headers[HEADERS.cooperativeId] = cooperativeId
  if (idempotencyKey) headers[HEADERS.idempotencyKey] = idempotencyKey

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      credentials: 'include',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw ApiError.network()
  }

  if (response.status === 204) return undefined as TData

  const text = await response.text()
  let payload: unknown = null
  if (text.length > 0) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!response.ok) throw toApiError(response.status, payload)

  return (payload as ApiResponse<TData>).data
}

/** Reads a collection endpoint, keeping the pagination metadata alongside the rows. */
export async function apiRequestCollection<TItem>(
  path: string,
  options: RequestOptions = {},
): Promise<{ items: TItem[]; meta: unknown }> {
  const { query, ...rest } = options
  const url = buildUrl(path, query)
  const response = await fetch(url, {
    method: rest.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      'Accept-Language': currentLanguage(),
      ...(rest.cooperativeId ? { [HEADERS.cooperativeId]: rest.cooperativeId } : {}),
    },
    credentials: 'include',
  }).catch(() => {
    throw ApiError.network()
  })

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw toApiError(response.status, payload)
  const typed = payload as { data: TItem[]; meta: unknown }
  return { items: typed.data, meta: typed.meta }
}
