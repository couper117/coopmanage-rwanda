import { createApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './lib/logger.js'
import { checkDatabase, disconnectPrisma } from './lib/prisma.js'

async function main(): Promise<void> {
  const app = createApp()

  const database = await checkDatabase()
  if (database.reachable) {
    logger.info({ latencyMs: database.latencyMs }, 'database reachable')
  } else {
    // Not fatal: the process stays up and reports unready, so a restart loop does not hide the
    // real problem and the health endpoint can be used to diagnose it.
    logger.error({ error: database.error }, 'database unreachable at startup')
  }

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, environment: env.NODE_ENV }, 'CoopManage API listening')
  })

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down')
    server.close(() => {
      void disconnectPrisma().finally(() => process.exit(0))
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'failed to start')
  process.exit(1)
})
