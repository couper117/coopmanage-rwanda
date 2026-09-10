import type { Request, Response } from 'express'
import { sendData } from '../../lib/envelope.js'
import { AppError } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'
import { checkDatabase } from '../../lib/prisma.js'

/**
 * Liveness. Answers as long as the process is running and never touches the database.
 *
 * The response is deliberately bare. These probes are unauthenticated, and a load balancer needs
 * only to know that the process answers; the environment name, process uptime and query latency
 * that an earlier version returned told an anonymous caller about the deployment for no benefit.
 * Those details are in the logs, where they belong.
 */
export function getHealth(_req: Request, res: Response): void {
  sendData(res, { status: 'ok', timestamp: new Date().toISOString() })
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
  logger.debug({ latencyMs: database.latencyMs }, 'readiness check passed')
  sendData(res, {
    status: 'ready',
    checks: { database: { reachable: true } },
    timestamp: new Date().toISOString(),
  })
}
