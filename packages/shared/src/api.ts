/** The API contract shared by both applications. See `docs/api.md`. */

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'MALFORMED_REQUEST',
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'FORBIDDEN',
  'NO_COOPERATIVE_ACCESS',
  'NOT_FOUND',
  'DUPLICATE_RESOURCE',
  'CONFLICT',
  'INSUFFICIENT_STOCK',
  'INVALID_STATE_TRANSITION',
  'IDEMPOTENCY_KEY_REUSED',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_FILE_TYPE',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export type MessageParams = Record<string, string | number>

export interface ApiFieldError {
  field: string
  messageKey: string
  messageParams?: MessageParams
}

export interface ApiErrorBody {
  code: ErrorCode
  messageKey: string
  messageParams?: MessageParams
  /**
   * Last-resort English sentence for a client that does not know `messageKey`. Clients translate
   * the key and use this only when the key is unknown to them, so it is deliberately not
   * localised on the server: the API carries no translation bundles.
   */
  message: string
  details?: ApiFieldError[]
  requestId: string
}

export interface ApiErrorResponse {
  error: ApiErrorBody
}

export interface PageMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
  sort?: string
}

export interface ApiResponse<TData, TMeta = Record<string, unknown>> {
  data: TData
  meta?: TMeta
}

export type ApiCollectionResponse<TItem> = ApiResponse<TItem[], PageMeta>

export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 100

/** Headers the API reads. Kept here so the client cannot misspell one. */
export const HEADERS = {
  cooperativeId: 'X-Cooperative-Id',
  requestId: 'X-Request-Id',
  idempotencyKey: 'Idempotency-Key',
} as const
