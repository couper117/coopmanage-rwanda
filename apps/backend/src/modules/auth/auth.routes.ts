import { AUTHENTICATED, createModuleRouter, PUBLIC } from '../../lib/routeRegistry.js'
import { authenticate } from '../../middleware/authenticate.js'
import {
  forgotPasswordEmailLimiter,
  forgotPasswordIpLimiter,
  loginEmailLimiter,
  loginIpLimiter,
} from '../../middleware/rateLimit.js'
import { optionalCooperative } from '../../middleware/resolveCooperative.js'
import { validate } from '../../middleware/validate.js'
import * as controller from './auth.controller.js'
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  sessionIdSchema,
  updateProfileSchema,
} from './auth.schemas.js'

const module = createModuleRouter('/auth')

/**
 * Four routes are public because they are how a session begins or is recovered, and each is rate
 * limited by IP and by account. `/auth/refresh` and `/auth/logout` authenticate with the refresh
 * cookie rather than a bearer token, which is why they are declared public here and check the
 * request origin in the controller.
 */
module.post(
  '/login',
  PUBLIC,
  loginIpLimiter,
  validate({ body: loginSchema }),
  loginEmailLimiter,
  controller.postLogin,
)
module.post('/refresh', PUBLIC, controller.postRefresh)
module.post('/logout', PUBLIC, controller.postLogout)
module.post(
  '/forgot-password',
  PUBLIC,
  forgotPasswordIpLimiter,
  validate({ body: forgotPasswordSchema }),
  forgotPasswordEmailLimiter,
  controller.postForgotPassword,
)
module.post(
  '/reset-password',
  PUBLIC,
  validate({ body: resetPasswordSchema }),
  controller.postResetPassword,
)

// Self-scoped: a session is required, but no permission. A user who belongs to no cooperative
// still has a profile, a password and a list of their own devices.
module.get('/me', AUTHENTICATED, authenticate, optionalCooperative, controller.getMe)
module.patch(
  '/me',
  AUTHENTICATED,
  authenticate,
  validate({ body: updateProfileSchema }),
  controller.patchMe,
)
module.post(
  '/change-password',
  AUTHENTICATED,
  authenticate,
  validate({ body: changePasswordSchema }),
  controller.postChangePassword,
)
module.get('/sessions', AUTHENTICATED, authenticate, controller.getSessions)
module.delete(
  '/sessions/:id',
  AUTHENTICATED,
  authenticate,
  validate({ params: sessionIdSchema }),
  controller.deleteSession,
)

export const authRouter = module.router
