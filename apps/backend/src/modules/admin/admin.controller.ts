import type { Request, Response } from 'express'
import type { SystemSettingKey } from '@coopmanage/shared'
import { buildPageMeta, sendCollection, sendData } from '../../lib/envelope.js'
import { AppError } from '../../lib/errors.js'
import {
  createCooperative,
  createUser,
  getSystemSettings,
  listCooperatives,
  listUsers,
  platformHealth,
  putSystemSetting,
  updateCooperative,
  updateUser,
} from './admin.service.js'

function ctxOf(req: Request) {
  const ctx = req.ctx
  if (!ctx) throw AppError.unauthenticated()
  return ctx
}

export async function getCooperatives(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as {
    q?: string
    status?: string
    typeKey?: string
    includeDemo?: 'true' | 'false'
    page: number
    pageSize: number
  }
  const { items, total } = await listCooperatives(query)
  sendCollection(res, items, buildPageMeta({ page: query.page, pageSize: query.pageSize, total }))
}

export async function postCooperative(req: Request, res: Response): Promise<void> {
  sendData(res, await createCooperative(ctxOf(req), req.validated?.body as never), 201)
}

export async function patchCooperative(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await updateCooperative(ctxOf(req), id, req.validated?.body as never))
}

export async function getUsers(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as {
    q?: string
    status?: string
    platformAdmin?: 'true' | 'false'
    page: number
    pageSize: number
  }
  const { items, total } = await listUsers(query)
  sendCollection(res, items, buildPageMeta({ page: query.page, pageSize: query.pageSize, total }))
}

export async function postUser(req: Request, res: Response): Promise<void> {
  sendData(res, await createUser(ctxOf(req), req.validated?.body as never), 201)
}

export async function patchUser(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await updateUser(ctxOf(req), id, req.validated?.body as never))
}

export async function getSettings(_req: Request, res: Response): Promise<void> {
  sendData(res, await getSystemSettings())
}

export async function putSetting(req: Request, res: Response): Promise<void> {
  const { key } = req.validated?.params as { key: SystemSettingKey }
  const { value } = req.validated?.body as { value: unknown }
  sendData(res, await putSystemSetting(ctxOf(req), key, value))
}

export async function getHealth(_req: Request, res: Response): Promise<void> {
  sendData(res, await platformHealth())
}
