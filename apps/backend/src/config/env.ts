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

    /**
     * Where uploaded documents are kept. `local` writes to `STORAGE_LOCAL_PATH`; `s3` is any
     * S3-compatible store — Supabase Storage in production, MinIO on a developer's machine — and
     * needs the four `S3_*` values below, which the refinement checks. Production refuses `local`,
     * because a container's disk is replaced on the next deployment and a cooperative's documents
     * with it.
     */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().min(1).default('./storage'),
    /** The store's endpoint, e.g. `https://<project>.supabase.co/storage/v1/s3`. */
    S3_ENDPOINT: z.string().url().optional(),
    S3_BUCKET: z.string().min(1).optional(),
    /** Supabase's S3 endpoint expects the project's region; MinIO accepts anything. */
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    /** The cap on one uploaded file. 10 MB covers a scanned certificate and a long PDF. */
    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(10),

    /**
     * Which SMS provider carries a cooperative's announcements.
     *
     * One value today, and it needs no credentials: `mock` records every message with its body and
     * its number and delivers none of them. That is a Phase 12 exit criterion — development runs
     * with no SMS credentials — and a gateway lands with the account it needs rather than as an
     * adapter written against nothing and never run.
     */
    SMS_PROVIDER: z.enum(['mock']).default('mock'),

    /**
     * How a password-setting link reaches the person it is for. `console` writes it to the log
     * outside production and warns without it in production; `smtp` sends it and needs the two
     * values below. Production may run on `console` — a platform without e-mail can still be
     * administered by relaying links by hand — but says so at startup and on every message.
     */
    MAIL_DRIVER: z.enum(['console', 'smtp']).default('console'),
    /** `smtp://user:pass@host:587` or `smtps://user:pass@host:465`. */
    SMTP_URL: z.string().url().optional(),
    /** The From header, `CoopManage <no-reply@example.rw>`. */
    SMTP_FROM: z.string().min(3).optional(),
    /**
     * Which planner reads a question and picks a tool for the assistant.
     *
     * One value today, and it needs no credentials: `rules` matches the words in a question
     * against a fixed table in both languages. A model-backed planner lands behind the same
     * interface when there is an account to run it under, and the guarantee does not depend on
     * which is live — a planner never produces a figure, because every figure comes from a query.
     */
    ASSISTANT_PLANNER: z.enum(['rules']).default('rules'),

    /**
     * Whether the refresh cookie may travel on a cross-site request.
     *
     * `lax` is the default and the stronger setting: the cookie is not sent on a cross-site
     * request at all, which is a second lock on top of the origin check the refresh and logout
     * endpoints already make.
     *
     * It also requires the browser application and this API to be the **same site** — two
     * subdomains of one registrable domain, `app.example.rw` and `api.example.rw`. Deployed across
     * two sites — a default Vercel domain and a default Railway one, say — a `lax` cookie is
     * silently never sent, the refresh call fails, and every session ends when the access token
     * expires fifteen minutes in. Nothing errors; people are simply signed out all day.
     *
     * That failure is invisible in development, where both sides are localhost and therefore the
     * same site, which is exactly why this is a stated choice rather than a hard-coded value.
     * Setting `none` allows the cross-site deployment and gives up the `SameSite` lock; the origin
     * check and the bearer token on every other endpoint are what remain. Phase 15 found it.
     */
    COOKIE_SAMESITE: z.enum(['lax', 'none']).default('lax'),
    /**
     * The name a cooperative's messages appear to come from, where the gateway supports one.
     * Optional: most Rwandan gateways assign a short code, and a made-up sender is worse than none.
     */
    SMS_SENDER_ID: z.string().trim().min(1).max(11).optional(),

    SEED_DEMO: booleanFromString.default(false),
    // Defaults to on outside production and off in production. Setting it explicitly wins,
    // which is what docs/api.md section 4 promises.
    ENABLE_API_DOCS: booleanFromString.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.STORAGE_DRIVER === 's3') {
      for (const key of [
        'S3_ENDPOINT',
        'S3_BUCKET',
        'S3_ACCESS_KEY_ID',
        'S3_SECRET_ACCESS_KEY',
      ] as const) {
        if (!value[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when STORAGE_DRIVER is s3`,
          })
        }
      }
    }

    if (value.MAIL_DRIVER === 'smtp') {
      for (const key of ['SMTP_URL', 'SMTP_FROM'] as const) {
        if (!value[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when MAIL_DRIVER is smtp`,
          })
        }
      }
      if (value.SMTP_URL && !/^smtps?:\/\//.test(value.SMTP_URL)) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_URL'],
          message: 'SMTP_URL must start with smtp:// or smtps://',
        })
      }
    }

    if (value.NODE_ENV !== 'production') return

    if (value.STORAGE_DRIVER === 'local') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message:
          'production must keep documents in an object store (STORAGE_DRIVER=s3); a container disk is replaced on the next deployment',
      })
    }

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
    // `SameSite=None` is only honoured by a browser on a `Secure` cookie, and this API sets
    // `Secure` from `NODE_ENV`. Over plain HTTP the cookie would be dropped entirely, which is the
    // same silent sign-out this setting exists to prevent.
    if (value.COOKIE_SAMESITE === 'none' && !value.APP_BASE_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SAMESITE'],
        message: 'SameSite=None needs a Secure cookie, so APP_BASE_URL must be https in production',
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
