import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

loadDotenv()

/**
 * Environment configuration. The process refuses to start on a missing or malformed value rather
 * than failing later at request time, when the cause is much harder to see.
 */
/** Values shipped in .env.example. None may reach production. */
const PLACEHOLDER_SECRETS = new Set(['replace-me-with-a-long-random-value'])

/** localhost, 127.0.0.1, ::1 or 0.0.0.0, in any scheme and on any port. */
function isLoopbackOrigin(origin: string): boolean {
  return /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i.test(origin.trim())
}

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
    JWT_ACCESS_TTL: z
      .string()
      .regex(/^\d+[smhd]$/, 'must be a duration such as 15m or 1h')
      .default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),

    /** Where the browser application is served. Password reset links are built against it. */
    APP_BASE_URL: z.string().url().default('http://localhost:5175'),

    SEED_DEMO: booleanFromString.default(false),
    // Defaults to on outside production and off in production. Setting it explicitly wins,
    // which is what docs/api.md section 4 promises.
    ENABLE_API_DOCS: booleanFromString.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') return

    // Production must never fall back to a development default or to a value copied out of
    // .env.example, which is the mistake this guard exists to catch.
    const placeholder =
      PLACEHOLDER_SECRETS.has(value.JWT_ACCESS_SECRET) ||
      value.JWT_ACCESS_SECRET.includes('development-only') ||
      /^(replace|change)[-_ ]?me/i.test(value.JWT_ACCESS_SECRET)

    if (placeholder || value.JWT_ACCESS_SECRET.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message:
          'must be a real random value of at least 32 characters in production, not a placeholder',
      })
    }
    if (value.CORS_ORIGINS.some(isLoopbackOrigin)) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'must not allow a loopback origin in production',
      })
    }
  })
  .transform((value) => ({
    ...value,
    ENABLE_API_DOCS: value.ENABLE_API_DOCS ?? value.NODE_ENV !== 'production',
  }))

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
