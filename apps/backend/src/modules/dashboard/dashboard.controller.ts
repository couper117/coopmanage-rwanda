import type { Request, Response } from 'express'
import { sendData } from '../../lib/envelope.js'
import { requireContext } from '../../middleware/requirePermission.js'
import { getDashboard } from './dashboard.service.js'
import type { SearchQuery } from './dashboard.schemas.js'
import { search } from './search.service.js'

export async function getSummary(req: Request, res: Response): Promise<void> {
  sendData(res, await getDashboard(requireContext(req)))
}

export async function getSearch(req: Request, res: Response): Promise<void> {
  const { q } = req.validated?.query as SearchQuery
  sendData(res, await search(requireContext(req), q))
}
