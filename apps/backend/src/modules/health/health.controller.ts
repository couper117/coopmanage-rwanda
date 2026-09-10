import type { Request, Response } from 'express'
import { env } from '../../config/env.js'
import { sendData } from '../../lib/envelope.js'
import { AppError } from '../../lib/errors.js'
import { checkDatabase } from '../../lib/prisma.js'

const startedAt = Date.now()

/** Liveness. Answers as long as the process is running; it never touches the database. */
export function getHealth(_req: Request, res: Response): void {
  sendData(res, {
    status: 'ok',
    environment: env.NODE_ENV,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  })
}

/** Readiness. Reports 503 when the database is unreachable, so a host can hold traffic back. */
export async function getReadiness(_req: Request, res: Response): Promise<void> {
  const database = await checkDatabase()
  if (!database.reachable) {
    throw AppError.serviceUnavailable(
      'errors.databaseUnavailable',
      'The database is not reachable at the moment.',
    )
  }
  sendData(res, {
    status: 'ready',
    checks: { database: { reachable: true, latencyMs: database.latencyMs } },
    timestamp: new Date().toISOString(),
  })
}
