import 'dotenv/config'
import { defineConfig } from '@prisma/config'

/**
 * Prisma 7 moved the connection URL out of schema.prisma. Migration and introspection commands
 * read it from here; the runtime client gets it through the pg driver adapter in src/lib/prisma.ts.
 *
 * `prisma generate` runs where there is no database at all — the image build — and needs no URL,
 * but the config must still load. A placeholder that cannot connect stands in there; every command
 * that does connect (`migrate deploy`, `migrate status`) has the real value in its environment.
 */
const PLACEHOLDER = 'postgresql://unset:unset@localhost:5432/unset'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || PLACEHOLDER,
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
})
