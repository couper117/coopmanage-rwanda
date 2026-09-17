import { describe, expect, it } from 'vitest'
import { parseEnv } from '../src/config/env.js'

const BASE = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5435/db',
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
    const PROD = { ...BASE, NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example' }

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
