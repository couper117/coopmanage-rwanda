import type { Request, Response } from 'express'
import { buildPageMeta, sendCollection, sendData } from '../../lib/envelope.js'
import { withIdempotency } from '../../lib/idempotency.js'
import { requireContext } from '../../middleware/requirePermission.js'
import {
  adjustStock,
  issueStock,
  listMovements,
  listStock,
  receiveStock,
  reverseMovement,
  stockValuation,
  transferStock,
} from './inventory.service.js'
import type {
  AdjustInput,
  IssueInput,
  ListMovementsQuery,
  ListStockQuery,
  ReceiveInput,
  TransferInput,
} from './inventory.schemas.js'

export async function getStock(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListStockQuery
  const { items, total, lowCount } = await listStock(requireContext(req), query)
  sendCollection(res, items, {
    ...buildPageMeta({ page: query.page, pageSize: query.pageSize, total, sort: query.sort }),
    // How many products are at or below their minimum, across the whole catalogue rather than
    // this page, because that is the figure the overview leads with.
    lowCount,
  } as never)
}

/** The same list, already narrowed to what needs attention. */
export async function getLowStock(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListStockQuery
  const { items, total, lowCount } = await listStock(requireContext(req), {
    ...query,
    lowOnly: 'true',
  })
  sendCollection(res, items, {
    ...buildPageMeta({ page: query.page, pageSize: query.pageSize, total, sort: query.sort }),
    lowCount,
  } as never)
}

export async function getMovements(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListMovementsQuery
  const { items, total, totals } = await listMovements(requireContext(req), query)
  sendCollection(res, items, {
    ...buildPageMeta({ page: query.page, pageSize: query.pageSize, total, sort: query.sort }),
    totals,
  } as never)
}

/**
 * The four movements, each at most once per retry key.
 *
 * Stock is exactly like money in this respect: a storekeeper on a slow connection presses Receive,
 * the page hangs, and they press it again. Two receipts of the same forty sacks is a store record
 * that has to be corrected by hand.
 */
export async function postReceive(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const input = req.validated?.body as ReceiveInput
  const result = await withIdempotency(req, ctx, 'POST /inventory/receive', 201, () =>
    receiveStock(ctx, input),
  )
  sendData(res, result.data, result.status)
}

export async function postIssue(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const input = req.validated?.body as IssueInput
  const result = await withIdempotency(req, ctx, 'POST /inventory/issue', 201, () =>
    issueStock(ctx, input),
  )
  sendData(res, result.data, result.status)
}

export async function postAdjust(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const input = req.validated?.body as AdjustInput
  const result = await withIdempotency(req, ctx, 'POST /inventory/adjust', 201, () =>
    adjustStock(ctx, input),
  )
  sendData(res, result.data, result.status)
}

export async function postTransfer(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const input = req.validated?.body as TransferInput
  const result = await withIdempotency(req, ctx, 'POST /inventory/transfer', 201, () =>
    transferStock(ctx, input),
  )
  sendData(res, result.data, result.status)
}

export async function postReverse(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const { id } = req.validated?.params as { id: string }
  const { reason } = req.validated?.body as { reason: string }
  const result = await withIdempotency(
    req,
    ctx,
    'POST /inventory/transactions/:id/reverse',
    200,
    () => reverseMovement(ctx, id, reason),
  )
  sendData(res, result.data, result.status)
}

export async function getValuation(req: Request, res: Response): Promise<void> {
  sendData(res, await stockValuation(requireContext(req)))
}
