import type { ApiFieldError, ErrorCode, MessageParams } from '@coopmanage/shared'

interface AppErrorOptions {
  status: number
  code: ErrorCode
  messageKey: string
  messageParams?: MessageParams
  /** Fallback sentence for clients that do not know the key. */
  message: string
  details?: ApiFieldError[]
  cause?: unknown
}

/**
 * The only error type the API deliberately produces. It carries an HTTP status, a stable machine
 * code, a translation key with parameters, and a fallback sentence. Anything else that reaches the
 * error handler becomes an opaque 500, because an unplanned error must never leak its internals.
 */
export class AppError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly messageKey: string
  readonly messageParams: MessageParams | undefined
  readonly details: ApiFieldError[] | undefined

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'AppError'
    this.status = options.status
    this.code = options.code
    this.messageKey = options.messageKey
    this.messageParams = options.messageParams
    this.details = options.details
  }

  static validationFailed(details: ApiFieldError[]): AppError {
    return new AppError({
      status: 422,
      code: 'VALIDATION_FAILED',
      messageKey: 'errors.validationFailed',
      message:
        'Some of the information provided is not valid. Please check the highlighted fields.',
      details,
    })
  }

  static notFound(): AppError {
    return new AppError({
      status: 404,
      code: 'NOT_FOUND',
      messageKey: 'errors.notFound',
      message: 'We could not find what you were looking for.',
    })
  }

  static unauthenticated(): AppError {
    return new AppError({
      status: 401,
      code: 'UNAUTHENTICATED',
      messageKey: 'errors.unauthenticated',
      message: 'Please sign in to continue.',
    })
  }

  /**
   * Distinct from `unauthenticated` on purpose: the client refreshes silently on this and sends
   * the user to the login screen on that. Confusing the two either interrupts someone mid-form or
   * puts the client into a refresh loop against a token that will never be accepted.
   */
  static tokenExpired(): AppError {
    return new AppError({
      status: 401,
      code: 'TOKEN_EXPIRED',
      messageKey: 'errors.tokenExpired',
      message: 'Your session has expired. Please sign in again.',
    })
  }

  static invalidCredentials(): AppError {
    return new AppError({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      messageKey: 'errors.invalidCredentials',
      message: 'That email address and password do not match an account.',
    })
  }

  static accountLocked(minutes: number): AppError {
    return new AppError({
      status: 401,
      code: 'ACCOUNT_LOCKED',
      messageKey: 'errors.accountLocked',
      messageParams: { minutes },
      message: `Too many failed attempts. Try again in ${minutes} minutes.`,
    })
  }

  /**
   * The caller has a session but no ACTIVE membership of the cooperative they named. A platform
   * identifier they may not see returns 404 instead, so ids cannot be probed.
   */
  static noCooperativeAccess(): AppError {
    return new AppError({
      status: 403,
      code: 'NO_COOPERATIVE_ACCESS',
      messageKey: 'errors.noCooperativeAccess',
      message: 'You do not have access to this cooperative.',
    })
  }

  static conflict(messageKey: string, message: string): AppError {
    return new AppError({ status: 409, code: 'CONFLICT', messageKey, message })
  }

  static forbidden(permission?: string): AppError {
    return new AppError({
      status: 403,
      code: 'FORBIDDEN',
      messageKey: 'errors.forbidden',
      messageParams: permission ? { permission } : undefined,
      message: 'You do not have permission to do this.',
    })
  }

  static rateLimited(): AppError {
    return new AppError({
      status: 429,
      code: 'RATE_LIMITED',
      messageKey: 'errors.rateLimited',
      message: 'Too many attempts. Please wait a moment and try again.',
    })
  }

  static serviceUnavailable(messageKey: string, message: string): AppError {
    return new AppError({ status: 503, code: 'SERVICE_UNAVAILABLE', messageKey, message })
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
