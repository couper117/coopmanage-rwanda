import type { Request, Response } from 'express'
import { buildPageMeta, sendCollection, sendData } from '../../lib/envelope.js'
import { withIdempotency } from '../../lib/idempotency.js'
import { requireContext } from '../../middleware/requirePermission.js'
import {
  cancelSale,
  confirmSale,
  createBuyer,
  createSale,
  getBuyer,
  getSale,
  listBuyers,
  listSales,
  recordSalePayment,
  saleReceipt,
  salesSummary,
  updateBuyer,
  updateSale,
} from './sales.service.js'
import type {
  ConfirmSaleInput,
  CreateBuyerInput,
  CreateSaleInput,
  ListBuyersQuery,
  ListSalesQuery,
  RecordPaymentInput,
  SalesSummaryQuery,
  UpdateBuyerInput,
  UpdateSaleInput,
} from './sales.schemas.js'

export async function getBuyers(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListBuyersQuery
  const { items, total } = await listBuyers(requireContext(req), query)
  sendCollection(
    res,
    items,
    buildPageMeta({ page: query.page, pageSize: query.pageSize, total, sort: query.sort }),
  )
}

export async function getOneBuyer(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await getBuyer(requireContext(req), id))
}

export async function postBuyer(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as CreateBuyerInput
  sendData(res, await createBuyer(requireContext(req), input), 201)
}

export async function patchBuyer(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as UpdateBuyerInput
  sendData(res, await updateBuyer(requireContext(req), id, input))
}

/**
 * A buyer's history. The same row the list returns, which already carries the totals, plus the
 * sales themselves so a profile needs one request rather than two.
 */
export async function getBuyerSummary(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const { id } = req.validated?.params as { id: string }
  const buyer = await getBuyer(ctx, id)
  const sales = await listSales(ctx, {
    buyerId: id,
    sort: '-saleDate',
    page: 1,
    pageSize: 25,
  })
  sendData(res, { buyer, sales: sales.items, totals: sales.totals })
}

export async function getSales(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListSalesQuery
  const { items, total, totals } = await listSales(requireContext(req), query)
  sendCollection(res, items, {
    ...buildPageMeta({ page: query.page, pageSize: query.pageSize, total, sort: query.sort }),
    // Confirmed sales only, across the whole filter rather than the page on screen.
    totals,
  } as never)
}

export async function getOneSale(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await getSale(requireContext(req), id))
}

export async function postSale(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as CreateSaleInput
  sendData(res, await createSale(requireContext(req), input), 201)
}

export async function patchSale(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as UpdateSaleInput
  sendData(res, await updateSale(requireContext(req), id, input))
}

/**
 * Confirming, at most once per retry key.
 *
 * This is the request where a retry matters most in the whole product: it takes stock out and
 * records money, and a storekeeper on a slow connection pressing Confirm twice would otherwise
 * empty the shelf twice over.
 */
export async function postConfirm(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as ConfirmSaleInput
  const result = await withIdempotency(req, ctx, 'POST /sales/:id/confirm', 200, () =>
    confirmSale(ctx, id, input),
  )
  sendData(res, result.data, result.status)
}

export async function postCancel(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const { id } = req.validated?.params as { id: string }
  const { reason } = req.validated?.body as { reason: string }
  const result = await withIdempotency(req, ctx, 'POST /sales/:id/cancel', 200, () =>
    cancelSale(ctx, id, reason),
  )
  sendData(res, result.data, result.status)
}

export async function postPayment(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as RecordPaymentInput
  const result = await withIdempotency(req, ctx, 'POST /sales/:id/payments', 201, () =>
    recordSalePayment(ctx, id, input),
  )
  sendData(res, result.data, result.status)
}

export async function getReceipt(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await saleReceipt(requireContext(req), id))
}

export async function getSalesSummary(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as SalesSummaryQuery
  sendData(res, await salesSummary(requireContext(req), query))
}
