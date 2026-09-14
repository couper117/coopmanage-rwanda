import type { Request, Response } from 'express'
import { sendData } from '../../lib/envelope.js'
import { AppError } from '../../lib/errors.js'
import {
  deactivateStaff,
  inviteStaff,
  listAssignableRoles,
  listCooperativePermissions,
  listOverrides,
  listStaff,
  putOverrides,
  updateStaff,
  type InviteStaffInput,
  type PutOverridesInput,
  type UpdateStaffInput,
} from './staff.service.js'

function ctxOf(req: Request) {
  const ctx = req.ctx
  if (!ctx) throw AppError.unauthenticated()
  return ctx
}

export async function getStaff(req: Request, res: Response): Promise<void> {
  const filters = (req.validated?.query ?? {}) as {
    status?: 'ACTIVE' | 'INACTIVE'
    roleKey?: string
  }
  sendData(res, await listStaff(ctxOf(req), filters))
}

export async function postInvite(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as InviteStaffInput
  const result = await inviteStaff(ctxOf(req), input)
  sendData(res, result, 201)
}

export async function patchStaff(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as UpdateStaffInput
  sendData(res, await updateStaff(ctxOf(req), id, input))
}

export async function postDeactivate(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const { reason } = (req.validated?.body ?? {}) as { reason?: string | null }
  sendData(res, await deactivateStaff(ctxOf(req), id, reason ?? null))
}

export async function getOverrides(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await listOverrides(ctxOf(req), id))
}

export async function putStaffOverrides(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as PutOverridesInput
  sendData(res, await putOverrides(ctxOf(req), id, input))
}

export async function getRoles(_req: Request, res: Response): Promise<void> {
  sendData(res, await listAssignableRoles())
}

export async function getPermissions(_req: Request, res: Response): Promise<void> {
  sendData(res, await listCooperativePermissions())
}
