import pino from 'pino'
import { env, isProduction, isTest } from '../config/env.js'

/**
 * Anything on this list is removed from every log line, permanently. Adding a field here is the
 * only place redaction is configured, so a new secret cannot be logged by accident somewhere else.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.tokenHash',
  '*.nationalId',
  '*.secret',
]

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  base: { service: 'coopmanage-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport:
    isProduction || isTest
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
})

export type Logger = typeof logger
