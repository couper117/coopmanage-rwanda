import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { env, isProduction } from '../config/env.js'
import { logger } from './logger.js'

/**
 * Prisma 7 connects through a driver adapter rather than reading the URL from the schema, so the
 * pool is configured here in application code.
 *
 * A single client serves the process. In development the module is re-evaluated on reload, so the
 * instance is cached on `globalThis` to avoid exhausting the connection pool.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: isProduction ? 10 : 5,
    connectionTimeoutMillis: 10_000,
  })
  return new PrismaClient({ adapter, log: ['warn', 'error'] })
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient()

if (!isProduction) globalForPrisma.prisma = prisma

export interface DatabaseHealth {
  reachable: boolean
  latencyMs: number | null
  error?: string
}

export async function checkDatabase(): Promise<DatabaseHealth> {
  const startedAt = process.hrtime.bigint()
  try {
    await prisma.$queryRaw`SELECT 1`
    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    return { reachable: true, latencyMs: Math.round(latencyMs * 100) / 100 }
  } catch (error) {
    logger.error({ err: error }, 'database health check failed')
    return {
      reachable: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : 'unknown error',
    }
  }
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect()
}
