import type { IncomingMessage } from 'node:http'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { env, isProduction, isTest } from './config/env.js'
import { AppError } from './lib/errors.js'
import { logger, REDACTED_PATHS } from './lib/logger.js'
import { errorHandler } from './middleware/errorHandler.js'
import { notFound } from './middleware/notFound.js'
import { methodRateLimiter } from './middleware/rateLimit.js'
import { requestContext } from './middleware/requestContext.js'
import { apiRouter } from './routes.js'

export const API_PREFIX = '/api/v1'

export function createApp(): Express {
  const app = express()

  // Only trust a forwarded client address where a proxy actually terminates the connection.
  // Trusting it everywhere would let any direct caller set X-Forwarded-For and choose the key
  // that rate limiting counts against.
  app.set('trust proxy', isProduction ? 1 : 'loopback')
  app.disable('x-powered-by')

  // First, so that every failure below this line carries an id the user can quote, including one
  // raised by CORS or by the body parser.
  app.use(requestContext)

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      // DENY rather than helmet's SAMEORIGIN default, matching the CSP frame-ancestors directive.
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  )

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and non-browser callers send no Origin header.
        if (!origin || env.CORS_ORIGINS.includes(origin)) {
          callback(null, true)
          return
        }
        // A browser asking from an origin we do not serve is a routine refusal, not a server
        // fault. The rejected origin is logged but never echoed back in the response, so the
        // caller learns nothing and the 5xx rate stays meaningful.
        logger.warn({ origin }, 'rejected cross-origin request')
        callback(
          new AppError({
            status: 403,
            code: 'FORBIDDEN',
            messageKey: 'errors.originNotAllowed',
            message: 'This origin is not allowed to call the API.',
          }),
        )
      },
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    }),
  )

  /**
   * Every browser capability this product does not use, switched off.
   *
   * A cooperative's records need no camera, no microphone, no location, no payment handler and no
   * USB. Denying them costs nothing and means a compromised dependency cannot quietly ask a
   * cooperative's browser for its position or its microphone. Helmet sets no `Permissions-Policy`
   * of its own, so this is stated rather than inherited.
   *
   * It applies to the API's own responses. The browser application is served by the static host,
   * which `docs/deployment.md` says must send the same header — a value here does not travel to a
   * page served from somewhere else. Added in the Phase 15 review.
   */
  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), ' +
        'microphone=(), payment=(), usb=(), interest-cohort=()',
    )
    next()
  })

  app.use(compression())
  // The refresh token is the only cookie the API reads, and it is HttpOnly. Nothing is signed
  // here because the value is already an opaque random token verified against its stored hash.
  app.use(cookieParser())
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false, limit: '1mb' }))

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => (req as { requestId?: string }).requestId ?? 'unknown',
        redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
        customLogLevel(_req, res, err) {
          if (err || res.statusCode >= 500) return 'error'
          if (res.statusCode >= 400) return 'warn'
          return 'info'
        },
        /**
         * The path, and the **names** of the query parameters — never their values.
         *
         * `pino-http` logs the whole URL by default, which on this API means
         * `GET /search?q=Mukamana` writes a member's name into the log, and
         * `GET /members?q=0788123456` writes a telephone number. Those logs are read by operators
         * and retained by a hosting platform, and neither needs to know who a cooperative searched
         * for. The parameter names are kept because "this request was filtered by status and page"
         * is what a log is actually useful for.
         *
         * Found in the Phase 15 review; `docs/security.md` §9 records it.
         */
        serializers: {
          req(req: IncomingMessage & { id?: unknown; url?: string; method?: string }) {
            const raw = req.url ?? ''
            const separator = raw.indexOf('?')
            const path = separator === -1 ? raw : raw.slice(0, separator)
            const names =
              separator === -1
                ? []
                : [...new URLSearchParams(raw.slice(separator + 1)).keys()].sort()

            return {
              id: req.id,
              method: req.method,
              url: path,
              ...(names.length > 0 ? { queryNames: names } : {}),
            }
          },
        },
        autoLogging: { ignore: (req) => req.url === `${API_PREFIX}/health` },
      }),
    )
  }

  // Rate limiting applies to the whole API rather than being opted into per route, so a new
  // endpoint is covered the moment it is added. Limits are chosen by method and documented in
  // docs/api.md section 1.
  app.use(API_PREFIX, methodRateLimiter)

  app.use(API_PREFIX, apiRouter)

  app.use(notFound)
  app.use(errorHandler)

  return app
}
