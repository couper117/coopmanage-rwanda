import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { HEADERS } from '@coopmanage/shared'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string
    }
  }
}

/**
 * Assigns a request id and echoes it back. Every log line and every error body carries it, so a
 * user reporting a problem can quote one string and the exact request can be found.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(HEADERS.requestId)
  const requestId = incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomUUID()
  req.requestId = requestId
  res.setHeader(HEADERS.requestId, requestId)
  next()
}
