import type {
  ApiErrorBody,
  ApiResponse,
  CursorMeta,
  ErrorCode,
  MessageParams,
  PageMeta,
} from '@coopmanage/shared'
import { HEADERS } from '@coopmanage/shared'
import { currentLanguage } from '@/i18n'
import { authState } from '@/stores/authStore'

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

  /**
   * A successful status carrying something that is not our envelope. In practice this is a proxy
   * or gateway page returned with a 2xx, and it must not reach a caller as a TypeError.
   */
  static malformedResponse(status: number): ApiError {
    return new ApiError({
      status,
      code: 'INTERNAL_ERROR',
      messageKey: 'errors.internal',
      message: 'The server returned a response we could not read.',
    })
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /**
   * Overrides the cooperative the session is currently working in. Almost nothing needs this:
   * the active cooperative is attached automatically.
   */
  cooperativeId?: string
  /** Skips the bearer token and the silent refresh. Only the authentication endpoints use it. */
  anonymous?: boolean
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
 * Performs the request and returns the whole envelope. Every call in the application goes through
 * here, so headers, error shape, language handling and abort behaviour cannot drift between
 * features.
 */
/**
 * A refresh in flight, shared by every request that discovers an expired token at the same moment.
 * Without this, a screen firing four queries would send four refreshes; the server rotates on each
 * one and treats the second as a replayed token, revoking the family and signing the user out —
 * the exact failure the rotation scheme exists to detect.
 */
let refreshInFlight: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'include',
      })
      if (!response.ok) return false
      const payload = (await response.json()) as { data?: { accessToken?: string } }
      const token = payload.data?.accessToken
      if (typeof token !== 'string') return false
      authState.setAccessToken(token)
      return true
    } catch {
      return false
    } finally {
      // Cleared on the microtask after the awaiting callers have read the result, so a later
      // request starts a fresh attempt rather than reusing a settled one.
      queueMicrotask(() => {
        refreshInFlight = null
      })
    }
  })()
  return refreshInFlight
}

async function send(
  path: string,
  options: RequestOptions,
  headers: Record<string, string>,
): Promise<Response> {
  const { method = 'GET', body, signal, query } = options
  try {
    return await fetch(buildUrl(path, query), {
      method,
      headers,
      credentials: 'include',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    })
  } catch (error) {
    // An abort is the caller's own decision, not a failure to report to the user.
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw ApiError.network()
  }
}

/**
 * The headers every request carries: the language, the bearer token and the cooperative being
 * worked in. Built fresh for each attempt, because a replay after a silent refresh has to pick up
 * the new token rather than resend the expired one.
 */
function buildHeaders(options: RequestOptions, accept: string): Record<string, string> {
  const { body, cooperativeId, idempotencyKey, anonymous = false } = options
  const headers: Record<string, string> = {
    Accept: accept,
    'Accept-Language': currentLanguage(),
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idempotencyKey) headers[HEADERS.idempotencyKey] = idempotencyKey
  if (anonymous) return headers

  const token = authState.accessToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const tenant = cooperativeId ?? authState.cooperativeId()
  if (tenant) headers[HEADERS.cooperativeId] = tenant
  return headers
}

/**
 * Sends a request, and on the one status that means "the token has expired but the session is
 * still good", refreshes once and replays it.
 *
 * Shared by the JSON path and the file path. An access token lasts fifteen minutes, and a
 * cooperative producing a report after reading the screen for twenty of them must not be told the
 * export failed.
 */
async function sendWithRefresh(
  path: string,
  options: RequestOptions,
  accept: string,
): Promise<Response> {
  const { anonymous = false } = options
  let response = await send(path, options, buildHeaders(options, accept))

  if (response.status === 401 && !anonymous) {
    const payload = (await response
      .clone()
      .json()
      .catch(() => null)) as { error?: { code?: string } } | null
    if (payload?.error?.code === 'TOKEN_EXPIRED') {
      if (await refreshAccessToken()) {
        response = await send(path, options, buildHeaders(options, accept))
      } else {
        authState.signedOut()
      }
    } else {
      // Any other 401 on an authenticated request means the session is genuinely over — signed
      // out elsewhere, account suspended, token tampered with. Retrying would achieve nothing.
      authState.signedOut()
    }
  }

  return response
}

async function request<TData, TMeta = unknown>(
  path: string,
  options: RequestOptions,
): Promise<{ data: TData; meta: TMeta | undefined }> {
  const response = await sendWithRefresh(path, options, 'application/json')

  if (response.status === 204) {
    return { data: undefined as TData, meta: undefined }
  }

  const text = await response.text()
  let payload: unknown = null
  let parsed = false
  if (text.length > 0) {
    try {
      payload = JSON.parse(text)
      parsed = true
    } catch {
      parsed = false
    }
  }

  if (!response.ok) throw toApiError(response.status, payload)

  // A 2xx that is empty, unparseable, or not shaped like our envelope. Returning it would put
  // `undefined` where a caller expects data and surface later as an unrelated crash.
  if (!parsed || typeof payload !== 'object' || payload === null || !('data' in payload)) {
    throw ApiError.malformedResponse(response.status)
  }

  const envelope = payload as ApiResponse<TData, TMeta>
  return { data: envelope.data, meta: envelope.meta }
}

/** Reads a single resource and unwraps the envelope. */
export async function apiRequest<TData>(
  path: string,
  options: RequestOptions = {},
): Promise<TData> {
  const { data } = await request<TData>(path, options)
  return data
}

/** Reads a collection endpoint, keeping the pagination metadata alongside the rows. */
export async function apiRequestCollection<TItem>(
  path: string,
  options: RequestOptions = {},
): Promise<{ items: TItem[]; meta: PageMeta | undefined }> {
  const { data, meta } = await request<TItem[], PageMeta>(path, options)
  return { items: data, meta }
}

/** Reads a cursor-paged feed, such as the audit log, keeping the cursor alongside the rows. */
export async function apiRequestCursor<TItem>(
  path: string,
  options: RequestOptions = {},
): Promise<{ items: TItem[]; meta: CursorMeta | undefined }> {
  const { data, meta } = await request<TItem[], CursorMeta>(path, options)
  return { items: data, meta }
}

export interface DownloadedFile {
  blob: Blob
  /** The name the server gave the file, which carries the cooperative code and the period. */
  filename: string
}

/**
 * Reads an endpoint that answers with a file rather than a JSON envelope.
 *
 * Everything the JSON path does is done here too — the language header, the bearer token, the
 * cooperative header, one silent refresh and replay on an expired token, and a failure reported as
 * the same `ApiError` every other call produces — because a download is not a lesser kind of
 * request. An error response is still JSON, so a refusal is read out of the body and given to the
 * screen in the form it already knows how to show.
 */
export async function apiRequestFile(
  path: string,
  options: RequestOptions & { accept?: string; fallbackFilename: string },
): Promise<DownloadedFile> {
  const response = await sendWithRefresh(
    path,
    options,
    options.accept ?? 'application/octet-stream',
  )

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as unknown
    throw toApiError(response.status, payload)
  }

  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(
      response.headers.get('Content-Disposition'),
      options.fallbackFilename,
    ),
  }
}

/** The server names the file with the cooperative code and the period, which is worth keeping. */
export function filenameFromDisposition(disposition: string | null, fallback: string): string {
  const match = disposition ? /filename="?([^";]+)"?/.exec(disposition) : null
  return match?.[1] ?? fallback
}
