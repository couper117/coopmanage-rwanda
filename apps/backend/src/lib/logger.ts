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
  // A member's telephone is personal data in the same way their identity number is, and Phase 12
  // gave the application a reason to hold one in a log line: a message's destination.
  '*.phone',
  '*.toPhone',
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
