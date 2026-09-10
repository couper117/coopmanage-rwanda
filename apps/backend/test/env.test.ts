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
