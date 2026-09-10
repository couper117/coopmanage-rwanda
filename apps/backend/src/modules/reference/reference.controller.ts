import type { Request, Response } from 'express'
import { sendData } from '../../lib/envelope.js'
import { listCooperativeTypes } from './reference.service.js'

export async function getCooperativeTypes(_req: Request, res: Response): Promise<void> {
  sendData(res, await listCooperativeTypes())
}
