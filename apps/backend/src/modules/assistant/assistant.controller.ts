import type { Request, Response } from 'express'
import { buildPageMeta, sendCollection, sendData } from '../../lib/envelope.js'
import { requireContext } from '../../middleware/requirePermission.js'
import * as service from './assistant.service.js'
import type { AskInput, ListThreadsQuery } from './assistant.schemas.js'

export async function postAsk(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as AskInput
  sendData(res, await service.ask(requireContext(req), input))
}

/** What this reader can ask, and which planner is live. Read by the screen before the first ask. */
export function getCatalogue(req: Request, res: Response): void {
  sendData(res, service.catalogueFor(requireContext(req)))
}

export async function getThreads(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListThreadsQuery
  const { items, total } = await service.listThreads(requireContext(req), query)
  sendCollection(res, items, buildPageMeta({ page: query.page, pageSize: query.pageSize, total }))
}

export async function getThread(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await service.readThread(requireContext(req), id))
}
