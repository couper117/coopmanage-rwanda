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

  static notFound(resourceKey = 'errors.resource'): AppError {
    return new AppError({
      status: 404,
      code: 'NOT_FOUND',
      messageKey: 'errors.notFound',
      messageParams: { resource: resourceKey },
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
