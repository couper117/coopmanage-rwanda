import type { Request, Response } from 'express'
import { buildPageMeta, sendCollection, sendData } from '../../lib/envelope.js'
import { AppError } from '../../lib/errors.js'
import { idempotencyKeyOf, withIdempotency } from '../../lib/idempotency.js'
import { requireContext } from '../../middleware/requirePermission.js'
import { sms } from '../../lib/sms/index.js'
import * as service from './sms.service.js'
import type { ListSmsQuery, SendSmsInput } from './sms.schemas.js'

export async function getMessages(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListSmsQuery
  const result = await service.listMessages(requireContext(req), query)
  sendCollection(
    res,
    result.items,
    buildPageMeta({ page: query.page, pageSize: query.pageSize, total: result.total }),
  )
}

/** What the screens need to say before anybody sends: which provider, and whether it delivers. */
export function getProvider(_req: Request, res: Response): void {
  const provider = sms()
  sendData(res, { provider: provider.name, delivers: provider.delivers })
}

/**
 * An ad-hoc message to named members.
 *
 * The `Idempotency-Key` header is **required** here, unlike anywhere else in this API. Elsewhere a
 * repeat writes a duplicate that a cooperative can void; here it puts a second message on a
 * member's telephone, which cannot be taken back. So the key is the dedupe key's prefix, and a
 * request without one is refused rather than sent.
 */
export async function postSend(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const input = req.validated?.body as SendSmsInput
  const key = idempotencyKeyOf(req)
  if (!key) {
    throw AppError.validationFailed([
      { field: 'headers.Idempotency-Key', messageKey: 'validation.required' },
    ])
  }

  const result = await withIdempotency(req, ctx, 'POST /sms/send', 200, () =>
    service.sendToMembers(ctx, input, key),
  )
  sendData(res, result.data, result.status)
}
