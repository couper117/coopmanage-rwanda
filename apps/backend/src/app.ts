import compression from 'compression'
import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { env, isTest } from './config/env.js'
import { logger, REDACTED_PATHS } from './lib/logger.js'
import { errorHandler } from './middleware/errorHandler.js'
import { notFound } from './middleware/notFound.js'
import { requestContext } from './middleware/requestContext.js'
import { apiRouter } from './routes.js'

export const API_PREFIX = '/api/v1'

export function createApp(): Express {
  const app = express()

  // Behind Railway/Vercel the client address arrives in X-Forwarded-For. Trust exactly one proxy
  // rather than `true`, which would let a client spoof its own address and defeat rate limiting.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

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
        callback(new Error(`Origin not allowed: ${origin}`))
      },
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    }),
  )

  app.use(compression())
  // Before the body parsers: a malformed JSON body fails inside express.json(), and that error
  // still has to carry a request id the user can quote.
  app.use(requestContext)
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
        autoLogging: { ignore: (req) => req.url === `${API_PREFIX}/health` },
      }),
    )
  }

  app.use(API_PREFIX, apiRouter)

  app.use(notFound)
  app.use(errorHandler)

  return app
}
