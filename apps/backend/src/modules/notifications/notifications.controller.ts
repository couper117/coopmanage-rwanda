import type { Request, Response } from 'express'
import { buildPageMeta, sendCollection, sendData } from '../../lib/envelope.js'
import { requireContext } from '../../middleware/requirePermission.js'
import * as service from './notifications.service.js'
import type { ListNotificationsQuery } from './notifications.schemas.js'

export async function getNotifications(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListNotificationsQuery
  const { items, total } = await service.listNotifications(requireContext(req), query)
  sendCollection(res, items, buildPageMeta({ page: query.page, pageSize: query.pageSize, total }))
}

/**
 * What the bell needs, and nothing more.
 *
 * The bell is on every screen and asks repeatedly; the centre is opened once in a while. Giving
 * the bell the whole paged list would make the commonest request the most expensive one, so this
 * returns the counts and the few most recent unread — enough to draw the badge and the short list
 * under it without a second round trip.
 */
export async function getSummary(req: Request, res: Response): Promise<void> {
  sendData(res, await service.notificationSummary(requireContext(req)))
}

export async function postRead(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await service.markRead(requireContext(req), id))
}

export async function postReadAll(req: Request, res: Response): Promise<void> {
  sendData(res, await service.markAllRead(requireContext(req)))
}

export async function postDismiss(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await service.dismiss(requireContext(req), id))
}
