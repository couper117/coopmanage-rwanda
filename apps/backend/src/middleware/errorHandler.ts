import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import type { ApiErrorResponse, ApiFieldError } from '@coopmanage/shared'
import { isProduction } from '../config/env.js'
import { AppError, isAppError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'

function zodToFieldErrors(error: ZodError): ApiFieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    messageKey: `validation.${issue.code}`,
    messageParams: { detail: issue.message },
  }))
}

/**
 * The single exit for every failure. Planned failures keep their code and translation key.
 * Anything else becomes an opaque 500: the user gets a sentence they can act on and the stack
 * trace goes to the log only.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error)
    return
  }

  const appError = toAppError(error)

  const logPayload = {
    err: error,
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    status: appError.status,
    code: appError.code,
  }
  if (appError.status >= 500) logger.error(logPayload, 'request failed')
  else logger.warn(logPayload, 'request rejected')

  const body: ApiErrorResponse = {
    error: {
      code: appError.code,
      messageKey: appError.messageKey,
      ...(appError.messageParams ? { messageParams: appError.messageParams } : {}),
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
      requestId: req.requestId ?? 'unknown',
    },
  }
  res.status(appError.status).json(body)
}

function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error

  if (error instanceof ZodError) return AppError.validationFailed(zodToFieldErrors(error))

  // Express 5 rejects malformed JSON bodies before any handler runs.
  if (
    error instanceof SyntaxError &&
    'status' in error &&
    (error as { status?: number }).status === 400
  ) {
    return new AppError({
      status: 400,
      code: 'MALFORMED_REQUEST',
      messageKey: 'errors.malformedJson',
      message: 'The request body is not valid JSON.',
    })
  }

  return new AppError({
    status: 500,
    code: 'INTERNAL_ERROR',
    messageKey: 'errors.internal',
    message: isProduction
      ? 'Something went wrong on our side. Please try again.'
      : `Unhandled error: ${error instanceof Error ? error.message : String(error)}`,
    cause: error,
  })
}
