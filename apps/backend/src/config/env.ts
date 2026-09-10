import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

loadDotenv()

/**
 * Environment configuration. The process refuses to start on a missing or malformed value rather
 * than failing later at request time, when the cause is much harder to see.
 */
const booleanFromString = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1')

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DIRECT_URL: z.string().min(1).optional(),

    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5175')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),

    JWT_ACCESS_SECRET: z
      .string()
      .min(1)
      .default('development-only-secret-do-not-use-in-production'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

    SEED_DEMO: booleanFromString.default(false),
    ENABLE_API_DOCS: booleanFromString.default(true),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') return

    // Production must never fall back to a development default.
    if (
      value.JWT_ACCESS_SECRET.includes('development-only') ||
      value.JWT_ACCESS_SECRET.length < 32
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'must be set to a random value of at least 32 characters in production',
      })
    }
    if (value.CORS_ORIGINS.some((origin) => origin.includes('localhost'))) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'must not allow a localhost origin in production',
      })
    }
  })

export type Env = z.infer<typeof envSchema>

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    )
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`)
  }
  return result.data
}

export const env: Env = parseEnv()

export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
