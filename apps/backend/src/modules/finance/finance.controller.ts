import type { Request, Response } from 'express'
import { buildPageMeta, sendCollection, sendData } from '../../lib/envelope.js'
import { withIdempotency } from '../../lib/idempotency.js'
import { requireContext } from '../../middleware/requirePermission.js'
import {
  createCategory,
  createTransaction,
  exportTransactionsCsv,
  exportTransactionsXlsx,
  financeSummary,
  financeTrends,
  getTransaction,
  listCategories,
  listTransactions,
  updateCategory,
  updateTransaction,
  voidTransactionById,
} from './finance.service.js'
import type {
  CreateCategoryInput,
  CreateTransactionInput,
  ExportTransactionsQuery,
  ListCategoriesQuery,
  ListTransactionsQuery,
  SummaryQuery,
  TrendsQuery,
  UpdateCategoryInput,
  UpdateTransactionInput,
} from './finance.schemas.js'

export async function getTransactions(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListTransactionsQuery
  const { items, total, totals } = await listTransactions(requireContext(req), query)
  sendCollection(res, items, {
    ...buildPageMeta({ page: query.page, pageSize: query.pageSize, total, sort: query.sort }),
    // The footer figures cover the whole filtered set, not the page on screen.
    totals,
  } as never)
}

/**
 * Records an entry, at most once per retry key.
 *
 * The response carries the same body whether the work happened now or on a first attempt the
 * client never saw, so a retry after a dropped connection looks like a success rather than a
 * duplicate.
 */
export async function postTransactionEntry(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const input = req.validated?.body as CreateTransactionInput
  const result = await withIdempotency(req, ctx, 'POST /finance/transactions', 201, () =>
    createTransaction(ctx, input),
  )
  sendData(res, result.data, result.status)
}

export async function getOneTransaction(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await getTransaction(requireContext(req), id))
}

export async function patchTransaction(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as UpdateTransactionInput
  sendData(res, await updateTransaction(requireContext(req), id, input))
}

export async function postVoidTransaction(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const { id } = req.validated?.params as { id: string }
  const { reason } = (req.validated?.body ?? {}) as { reason?: string | null }
  const result = await withIdempotency(req, ctx, 'POST /finance/transactions/:id/void', 200, () =>
    voidTransactionById(ctx, id, reason ?? null),
  )
  sendData(res, result.data, result.status)
}

export async function getSummary(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as SummaryQuery
  sendData(res, await financeSummary(requireContext(req), query))
}

export async function getTrends(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as TrendsQuery
  sendData(res, await financeTrends(requireContext(req), query))
}

/**
 * The ledger as a file, in whichever of the two formats was asked for.
 *
 * Sent as an attachment with a dated filename, because a cooperative keeps these and has to know
 * months later which period each one covers.
 */
export async function getExport(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const { format, ...filters } = req.validated?.query as ExportTransactionsQuery

  const code = ctx.cooperative?.code ?? 'cooperative'
  const stamp =
    filters.from && filters.to
      ? `${filters.from}-to-${filters.to}`
      : new Date().toISOString().slice(0, 10)
  const name = `finance-${code}-${stamp}`

  if (format === 'xlsx') {
    const buffer = await exportTransactionsXlsx(ctx, filters)
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`)
    res.send(buffer)
    return
  }

  const csv = await exportTransactionsCsv(ctx, filters)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`)
  res.send(csv)
}

export async function getCategories(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListCategoriesQuery
  sendData(res, await listCategories(requireContext(req), query))
}

export async function postCategory(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as CreateCategoryInput
  sendData(res, await createCategory(requireContext(req), input), 201)
}

export async function patchCategory(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as UpdateCategoryInput
  sendData(res, await updateCategory(requireContext(req), id, input))
}
