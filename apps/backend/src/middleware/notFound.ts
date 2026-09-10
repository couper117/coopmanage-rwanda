import type { NextFunction, Request, Response } from 'express'
import { AppError } from '../lib/errors.js'

export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(
    new AppError({
      status: 404,
      code: 'NOT_FOUND',
      messageKey: 'errors.routeNotFound',
      messageParams: { path: req.path },
      message: `No endpoint matches ${req.method} ${req.path}.`,
    }),
  )
}
