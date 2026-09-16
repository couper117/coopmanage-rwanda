import type { Request, Response } from 'express'
import { buildPageMeta, sendCollection, sendData } from '../../lib/envelope.js'
import { withIdempotency } from '../../lib/idempotency.js'
import { requireContext } from '../../middleware/requirePermission.js'
import * as service from './announcements.service.js'
import type {
  ArchiveAnnouncementInput,
  CreateAnnouncementInput,
  ListAnnouncementsQuery,
  PublishAnnouncementInput,
  UpdateAnnouncementInput,
} from './announcements.schemas.js'

export async function getAnnouncements(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListAnnouncementsQuery
  const { items, total } = await service.listAnnouncements(requireContext(req), query)
  sendCollection(res, items, buildPageMeta({ page: query.page, pageSize: query.pageSize, total }))
}

export async function getAnnouncement(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await service.getAnnouncement(requireContext(req), id))
}

export async function getAudience(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await service.audiencePreview(requireContext(req), id))
}

export async function postAnnouncement(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as CreateAnnouncementInput
  sendData(res, await service.createAnnouncement(requireContext(req), input), 201)
}

export async function patchAnnouncement(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as UpdateAnnouncementInput
  sendData(res, await service.updateAnnouncement(requireContext(req), id, input))
}

/**
 * Publishing carries an idempotency key for the same reason a sale's confirmation does: this is
 * the request that spends the cooperative's money. A secretary on a district-office connection
 * pressing Publish twice must send one round of messages, not two.
 *
 * The dedupe key on each message makes a repeat harmless even without this; the idempotency key is
 * what makes the *answer* the same, so the screen does not report "0 sent, 78 already sent" to
 * somebody whose first attempt appeared to hang.
 */
export async function postPublish(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as PublishAnnouncementInput
  const result = await withIdempotency(req, ctx, 'POST /announcements/:id/publish', 200, () =>
    service.publishAnnouncement(ctx, id, input),
  )
  sendData(res, result.data, result.status)
}

export async function postArchive(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as ArchiveAnnouncementInput
  sendData(res, await service.archiveAnnouncement(requireContext(req), id, input))
}
