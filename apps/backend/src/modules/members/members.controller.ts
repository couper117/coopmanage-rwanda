import type { Request, Response } from 'express'
import { buildPageMeta, sendCollection, sendData } from '../../lib/envelope.js'
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

export async function postMemberShare(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as RecordShareInput
  sendData(res, await recordShare(requireContext(req), id, input), 201)
}

export async function postMemberContribution(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as RecordContributionInput
  sendData(res, await recordContribution(requireContext(req), id, input), 201)
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
  const { id } = req.validated?.params as { id: string }
  const { reason } = (req.validated?.body ?? {}) as { reason?: string | null }
  sendData(res, await voidContribution(requireContext(req), id, reason ?? null))
}

export async function postVoidShare(req: Request, res: Response): Promise<void> {
  const { id, shareId } = req.validated?.params as { id: string; shareId: string }
  const { reason } = (req.validated?.body ?? {}) as { reason?: string | null }
  sendData(res, await voidShare(requireContext(req), id, shareId, reason ?? null))
}
