import 'dotenv/config'
import { defineConfig, env } from '@prisma/config'

/**
 * Prisma 7 moved the connection URL out of schema.prisma. Migration and introspection commands
 * read it from here; the runtime client gets it through the pg driver adapter in src/lib/prisma.ts.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DIRECT_URL') || env('DATABASE_URL'),
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
})
