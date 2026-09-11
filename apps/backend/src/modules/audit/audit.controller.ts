import type { Request, Response } from 'express'
import { sendCursorCollection } from '../../lib/envelope.js'
import { requireTenant } from '../../middleware/requirePermission.js'
import type { AuditQuery } from './audit.schemas.js'
import { listAuditEntries } from './audit.service.js'

export async function getAuditLog(req: Request, res: Response): Promise<void> {
  const ctx = requireTenant(req)
  const query = req.validated?.query as AuditQuery
  const { entries, meta } = await listAuditEntries(ctx.cooperative.id, query)
  sendCursorCollection(res, entries, meta)
}
