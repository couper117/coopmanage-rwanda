import type { Request, Response } from 'express'
import { buildPageMeta, sendCollection, sendData } from '../../lib/envelope.js'
import { withIdempotency } from '../../lib/idempotency.js'
import { requireContext } from '../../middleware/requirePermission.js'
import {
  createMember,
  exportMembersCsv,
  getMember,
  listContributions,
  listMemberShares,
  listMembers,
  memberContributions,
  memberFormOptions,
  memberStats,
  memberSummary,
  memberTimeline,
  recordContribution,
  recordShare,
  setMemberStatus,
  updateMember,
  voidContribution,
  voidShare,
} from './members.service.js'
import type {
  CreateMemberInput,
  ListMembersQuery,
  RecordContributionInput,
  RecordShareInput,
  UpdateMemberInput,
} from './members.schemas.js'

export async function getMembers(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListMembersQuery
  const { items, total } = await listMembers(requireContext(req), query)
  sendCollection(
    res,
    items,
    buildPageMeta({ page: query.page, pageSize: query.pageSize, total, sort: query.sort }),
  )
}

export async function postMember(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as CreateMemberInput
  sendData(res, await createMember(requireContext(req), input), 201)
}

export async function getOneMember(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await getMember(requireContext(req), id))
}

export async function patchMember(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as UpdateMemberInput
  sendData(res, await updateMember(requireContext(req), id, input))
}

export async function postMemberStatus(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as {
    status: string
    reason?: string | null
    exitedOn?: string | null
  }
  sendData(res, await setMemberStatus(requireContext(req), id, input))
}

export async function getMemberStats(req: Request, res: Response): Promise<void> {
  sendData(res, await memberStats(requireContext(req)))
}

export async function getMemberSummary(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await memberSummary(requireContext(req), id))
}

export async function getMemberTimeline(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await memberTimeline(requireContext(req), id))
}

export async function getMemberFormOptions(req: Request, res: Response): Promise<void> {
  sendData(res, await memberFormOptions(requireContext(req)))
}

/**
 * The register as a file. Sent as an attachment with a dated filename, because a cooperative
 * saves these and needs to know which is which months later.
 */
export async function getMembersExport(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const filters = req.validated?.query as Omit<ListMembersQuery, 'page' | 'pageSize'>
  const csv = await exportMembersCsv(ctx, filters)

  const stamp = new Date().toISOString().slice(0, 10)
  const code = ctx.cooperative?.code ?? 'cooperative'
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="members-${code}-${stamp}.csv"`)
  res.send(csv)
}

export async function getMemberShares(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await listMemberShares(requireContext(req), id))
}

/**
 * The four handlers below carry an idempotency key, and they are here for the same reason the
 * finance ledger's are.
 *
 * A member's contribution and a share purchase are **money**: a contribution posts an income entry
 * into the cooperative's books and a purchase does the same. A treasurer on a district-office
 * connection who presses Record twice because the page hung would otherwise leave the books
 * holding the same 7,500 francs twice, and somebody has to work out afterwards which of two
 * identical entries is real. Voiding is the same problem mirrored: two reversals of one
 * contribution take the total below where it started.
 *
 * Phase 13's third bullet asks for the `IdempotencyKey` table to be honoured across finance,
 * inventory and sales. It already was. These four were the gap, because a contribution is recorded
 * on the members screen and reads as a membership action rather than a financial one.
 */
export async function postMemberShare(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as RecordShareInput
  const result = await withIdempotency(req, ctx, 'POST /members/:id/shares', 201, () =>
    recordShare(ctx, id, input),
  )
  sendData(res, result.data, result.status)
}

export async function postMemberContribution(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as RecordContributionInput
  const result = await withIdempotency(req, ctx, 'POST /members/:id/contributions', 201, () =>
    recordContribution(ctx, id, input),
  )
  sendData(res, result.data, result.status)
}

export async function getContributions(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as {
    memberId?: string
    type?: string
    from?: string
    to?: string
    status?: string
    page: number
    pageSize: number
  }
  const { items, total, totalAmount } = await listContributions(requireContext(req), query)
  sendCollection(res, items, {
    ...buildPageMeta({ page: query.page, pageSize: query.pageSize, total }),
    // The footer total reflects the current filter across every page, not just this one.
    totalAmount,
  } as never)
}

export async function getMemberContributions(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await memberContributions(requireContext(req), id))
}

export async function postVoidContribution(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const { id } = req.validated?.params as { id: string }
  const { reason } = (req.validated?.body ?? {}) as { reason?: string | null }
  const result = await withIdempotency(req, ctx, 'POST /contributions/:id/void', 200, () =>
    voidContribution(ctx, id, reason ?? null),
  )
  sendData(res, result.data, result.status)
}

export async function postVoidShare(req: Request, res: Response): Promise<void> {
  const ctx = requireContext(req)
  const { id, shareId } = req.validated?.params as { id: string; shareId: string }
  const { reason } = (req.validated?.body ?? {}) as { reason?: string | null }
  const result = await withIdempotency(
    req,
    ctx,
    'POST /members/:id/shares/:shareId/void',
    200,
    () => voidShare(ctx, id, shareId, reason ?? null),
  )
  sendData(res, result.data, result.status)
}
