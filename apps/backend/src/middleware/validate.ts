import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { ZodType } from 'zod'
import { type ZodError } from 'zod'
import type { ApiFieldError } from '@coopmanage/shared'
import { AppError } from '../lib/errors.js'

interface ValidationSchemas {
  body?: ZodType
  query?: ZodType
  params?: ZodType
}

function toFieldErrors(error: ZodError, source: string): ApiFieldError[] {
  return error.issues.map((issue) => ({
    field: [source, ...issue.path.map(String)].filter(Boolean).join('.'),
    messageKey: `validation.${issue.code}`,
    messageParams: { detail: issue.message },
  }))
}

/**
 * Validates and replaces the request parts it is given. Schemas are strict by convention, so an
 * unknown query parameter is rejected rather than ignored: a typo in a filter must never silently
 * widen a result set.
 *
 * Express 5 exposes `req.query` as a getter, so the parsed value is stored separately on
 * `req.validated` rather than assigned back over it.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const errors: ApiFieldError[] = []
    const validated: { body?: unknown; query?: unknown; params?: unknown } = {}

    for (const source of ['body', 'query', 'params'] as const) {
      const schema = schemas[source]
      if (!schema) continue
      const result = schema.safeParse(req[source])
      if (result.success) validated[source] = result.data
      else errors.push(...toFieldErrors(result.error, source))
    }

    if (errors.length > 0) {
      next(AppError.validationFailed(errors))
      return
    }

    req.validated = validated
    next()
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      validated?: { body?: unknown; query?: unknown; params?: unknown }
    }
  }
}
