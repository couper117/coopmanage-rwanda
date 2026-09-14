import type { Request, Response } from 'express'
import type { CooperativeSettingKey } from '@coopmanage/shared'
import { sendData } from '../../lib/envelope.js'
import { AppError } from '../../lib/errors.js'
import {
  getCooperativeProfile,
  getCooperativeSettings,
  listMyCooperatives,
  putCooperativeSetting,
  updateCooperativeProfile,
} from './cooperatives.service.js'
import type { UpdateCooperativeInput } from './cooperatives.schemas.js'

function requireContext(req: Request) {
  const ctx = req.ctx
  if (!ctx) throw AppError.unauthenticated()
  return ctx
}

function requireCooperativeId(req: Request): string {
  const id = requireContext(req).cooperative?.id
  if (!id) throw AppError.noCooperativeAccess()
  return id
}

export async function getMine(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  sendData(res, await listMyCooperatives(ctx.user.id))
}

export async function getCurrent(req: Request, res: Response): Promise<void> {
  sendData(res, await getCooperativeProfile(requireCooperativeId(req)))
}

export async function patchCurrent(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as UpdateCooperativeInput
  sendData(res, await updateCooperativeProfile(requireContext(req), input))
}

export async function getSettings(req: Request, res: Response): Promise<void> {
  sendData(res, await getCooperativeSettings(requireCooperativeId(req)))
}

export async function putSetting(req: Request, res: Response): Promise<void> {
  const { key } = req.validated?.params as { key: CooperativeSettingKey }
  const { value } = req.validated?.body as { value: unknown }
  sendData(res, await putCooperativeSetting(requireContext(req), key, value))
}
