import { describe, expect, it } from 'vitest'
import { parseEnv } from '../src/config/env.js'

const BASE = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5435/db',
}

/** An object store, which production requires. */
const S3 = {
  STORAGE_DRIVER: 's3',
  S3_ENDPOINT: 'https://project.supabase.co/storage/v1/s3',
  S3_BUCKET: 'documents',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
}

describe('environment configuration', () => {
  it('applies documented defaults', () => {
    const env = parseEnv(BASE)
    expect(env.NODE_ENV).toBe('development')
    expect(env.PORT).toBe(4000)
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5175'])
    expect(env.SEED_DEMO).toBe(false)
    expect(env.ENABLE_API_DOCS).toBe(true)
  })

  it('refuses to start without a database URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/)
  })

  it('rejects a port outside the valid range', () => {
    expect(() => parseEnv({ ...BASE, PORT: '70000' })).toThrow(/PORT/)
  })

  it('rejects an unknown log level rather than falling back', () => {
    expect(() => parseEnv({ ...BASE, LOG_LEVEL: 'chatty' })).toThrow(/LOG_LEVEL/)
  })

  it('splits and trims the CORS origin list', () => {
    const env = parseEnv({
      ...BASE,
      CORS_ORIGINS: 'https://a.example , https://b.example',
    })
    expect(env.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example'])
  })

  it('reads booleans from the strings a shell actually provides', () => {
    expect(parseEnv({ ...BASE, SEED_DEMO: 'true' }).SEED_DEMO).toBe(true)
    expect(parseEnv({ ...BASE, SEED_DEMO: '1' }).SEED_DEMO).toBe(true)
    expect(parseEnv({ ...BASE, SEED_DEMO: 'false' }).SEED_DEMO).toBe(false)
  })

  describe('production guards', () => {
    const PROD = { ...BASE, NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example', ...S3 }

    it('refuses the development JWT secret', () => {
      expect(() => parseEnv(PROD as NodeJS.ProcessEnv)).toThrow(/JWT_ACCESS_SECRET/)
    })

    it('refuses a short JWT secret', () => {
      expect(() => parseEnv({ ...PROD, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
        /JWT_ACCESS_SECRET/,
      )
    })

    it('refuses the placeholder secret shipped in .env.example', () => {
      expect(() =>
        parseEnv({
          ...PROD,
          JWT_ACCESS_SECRET: 'replace-me-with-a-long-random-value',
        }),
      ).toThrow(/JWT_ACCESS_SECRET/)
    })

    it('refuses any loopback CORS origin, not just the word localhost', () => {
      for (const origin of ['http://127.0.0.1:5175', 'http://[::1]:5175', 'http://0.0.0.0:8080']) {
        expect(() =>
          parseEnv({
            ...PROD,
            JWT_ACCESS_SECRET: 'a'.repeat(48),
            CORS_ORIGINS: `https://app.example,${origin}`,
          }),
        ).toThrow(/CORS_ORIGINS/)
      }
    })

    it('keeps the API documentation closed in production unless it is switched on', () => {
      const closed = parseEnv({
        ...PROD,
        JWT_ACCESS_SECRET: 'a'.repeat(48),
      })
      expect(closed.ENABLE_API_DOCS).toBe(false)

      const opened = parseEnv({
        ...PROD,
        JWT_ACCESS_SECRET: 'a'.repeat(48),
        ENABLE_API_DOCS: 'true',
      })
      expect(opened.ENABLE_API_DOCS).toBe(true)
    })

    it('refuses a localhost CORS origin', () => {
      expect(() =>
        parseEnv({
          ...PROD,
          JWT_ACCESS_SECRET: 'a'.repeat(48),
          CORS_ORIGINS: 'https://app.example,http://localhost:5173',
        }),
      ).toThrow(/CORS_ORIGINS/)
    })

    it('accepts a correctly configured production environment', () => {
      const env = parseEnv({
        ...PROD,
        JWT_ACCESS_SECRET: 'a'.repeat(48),
      })
      expect(env.NODE_ENV).toBe('production')
    })

    it('refuses to keep documents on a container disk in production', () => {
      // The disk is replaced on the next deployment, and a cooperative's documents with it.
      expect(() =>
        parseEnv({ ...PROD, JWT_ACCESS_SECRET: 'a'.repeat(48), STORAGE_DRIVER: 'local' }),
      ).toThrow(/STORAGE_DRIVER/)
    })
  })

  describe('the e-mail channel', () => {
    it('needs a URL and a From address when it is SMTP, and the URL has to be SMTP', () => {
      expect(() => parseEnv({ ...BASE, MAIL_DRIVER: 'smtp' })).toThrow(/SMTP_URL/)
      expect(() => parseEnv({ ...BASE, MAIL_DRIVER: 'smtp' })).toThrow(/SMTP_FROM/)
      expect(() =>
        parseEnv({
          ...BASE,
          MAIL_DRIVER: 'smtp',
          SMTP_URL: 'https://mail.example',
          SMTP_FROM: 'x@example.test',
        }),
      ).toThrow(/smtp:\/\//)
      const ok = parseEnv({
        ...BASE,
        MAIL_DRIVER: 'smtp',
        SMTP_URL: 'smtps://user:pass@mail.example:465',
        SMTP_FROM: 'CoopManage <no-reply@example.rw>',
      })
      expect(ok.MAIL_DRIVER).toBe('smtp')
    })

    it('defaults to the console, in production too — loudly, but it starts', () => {
      expect(parseEnv({ ...BASE }).MAIL_DRIVER).toBe('console')
      expect(
        parseEnv({
          ...BASE,
          ...S3,
          NODE_ENV: 'production',
          CORS_ORIGINS: 'https://a.example',
          JWT_ACCESS_SECRET: 'a'.repeat(48),
        }).MAIL_DRIVER,
      ).toBe('console')
    })
  })

  describe('the object store', () => {
    it('is accepted in development with the four values it needs', () => {
      expect(parseEnv({ ...BASE, ...S3 }).STORAGE_DRIVER).toBe('s3')
    })

    it('names each value that is missing rather than failing on the first upload', () => {
      const { S3_SECRET_ACCESS_KEY: _secret, S3_BUCKET: _bucket, ...partial } = S3
      expect(() => parseEnv({ ...BASE, ...partial })).toThrow(/S3_SECRET_ACCESS_KEY/)
      expect(() => parseEnv({ ...BASE, ...partial })).toThrow(/S3_BUCKET/)
    })
  })
})

/**
 * The cookie's `SameSite`, which Phase 15 turned from a hard-coded value into a stated choice.
 *
 * The failure it guards against is silent rather than loud: a `lax` cookie deployed across two
 * sites is never sent, the refresh call fails, and a cooperative is signed out every fifteen
 * minutes with nothing in any log to say why.
 */
describe('the refresh cookie’s SameSite', () => {
  const REAL_SECRET = 'a'.repeat(48)
  const PROD = {
    ...BASE,
    ...S3,
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://app.example.rw',
    JWT_ACCESS_SECRET: REAL_SECRET,
  }

  it('defaults to the stronger setting', () => {
    expect(parseEnv(BASE).COOKIE_SAMESITE).toBe('lax')
  })

  it('refuses SameSite=None over plain HTTP in production', () => {
    // A browser drops a `SameSite=None` cookie that is not `Secure`, which is the same silent
    // sign-out by another route.
    expect(() =>
      parseEnv({
        ...PROD,
        COOKIE_SAMESITE: 'none',
        APP_BASE_URL: 'http://app.example.rw',
      }),
    ).toThrow(/APP_BASE_URL must be https/)
  })

  it('accepts SameSite=None over HTTPS, for a deliberate cross-site deployment', () => {
    const parsed = parseEnv({
      ...PROD,
      COOKIE_SAMESITE: 'none',
      APP_BASE_URL: 'https://app.example.rw',
    })
    expect(parsed.COOKIE_SAMESITE).toBe('none')
  })
})
