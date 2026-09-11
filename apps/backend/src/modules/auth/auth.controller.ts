import type { Request, Response } from 'express'
import { sendData, sendNoContent } from '../../lib/envelope.js'
import { AppError } from '../../lib/errors.js'
import { requireContext } from '../../middleware/requirePermission.js'
import {
  clearRefreshCookie,
  originIsAllowed,
  readRefreshCookie,
  setRefreshCookie,
} from './auth.cookies.js'
import type {
  ChangePasswordInput,
  LoginInput,
  ResetPasswordInput,
  UpdateProfileInput,
} from './auth.schemas.js'
import * as authService from './auth.service.js'

/** Client details recorded against a session, so the profile screen can name a device. */
function sessionInfo(req: Request) {
  return {
    req,
    userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
    ipAddress: req.ip ?? null,
  }
}

export async function postLogin(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as LoginInput
  const outcome = await authService.login(input, sessionInfo(req))
  setRefreshCookie(res, outcome.refreshToken, outcome.refreshExpiresAt)
  sendData(res, outcome.result)
}

export async function postRefresh(req: Request, res: Response): Promise<void> {
  // The cookie endpoints are the one place a browser attaches credentials unasked, so the origin
  // is checked as well as SameSite.
  if (!originIsAllowed(req)) throw AppError.forbidden()

  const presented = readRefreshCookie(req)
  if (!presented) throw AppError.unauthenticated()

  try {
    const outcome = await authService.refresh(presented, sessionInfo(req))
    setRefreshCookie(res, outcome.refreshToken, outcome.refreshExpiresAt)
    sendData(res, { accessToken: outcome.accessToken, expiresIn: outcome.expiresIn })
  } catch (error) {
    // A refused refresh leaves no cookie behind: keeping one only produces a client that retries
    // a token the server has already decided is dead.
    clearRefreshCookie(res)
    throw error
  }
}

export async function postLogout(req: Request, res: Response): Promise<void> {
  if (!originIsAllowed(req)) throw AppError.forbidden()
  await authService.logout(readRefreshCookie(req), req)
  clearRefreshCookie(res)
  sendNoContent(res)
}

export async function getMe(req: Request, res: Response): Promise<void> {
  sendData(res, await authService.sessionSummary(requireContext(req)))
}

export async function patchMe(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as UpdateProfileInput
  sendData(res, await authService.updateProfile(requireContext(req), req, input))
}

export async function postChangePassword(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const input = req.validated?.body as ChangePasswordInput
  await authService.changePassword(ctx, req, input, ctx.sessionFamilyId)
  sendNoContent(res)
}

export async function postForgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = req.validated?.body as { email: string }
  await authService.requestPasswordReset(email, req)
  // Always 204, whether or not the address is registered.
  sendNoContent(res)
}

export async function postResetPassword(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as ResetPasswordInput
  await authService.resetPassword(input, req)
  clearRefreshCookie(res)
  sendNoContent(res)
}

export async function getSessions(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  sendData(res, await authService.listSessions(ctx.user.id, ctx.sessionFamilyId))
}

export async function deleteSession(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  await authService.revokeSession(requireContext(req), req, id)
  sendNoContent(res)
}
