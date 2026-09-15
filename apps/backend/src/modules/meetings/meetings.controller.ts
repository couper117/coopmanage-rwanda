import type { Request, Response } from 'express'
import { buildPageMeta, sendCollection, sendData } from '../../lib/envelope.js'
import { requireContext } from '../../middleware/requirePermission.js'
import {
  attendanceOptions,
  createDecision,
  createMeeting,
  getMeeting,
  listMeetings,
  putAgenda,
  putAttendance,
  setMeetingStatus,
  updateDecision,
  updateMeeting,
} from './meetings.service.js'
import type {
  CreateDecisionInput,
  CreateMeetingInput,
  ListMeetingsQuery,
  PutAgendaInput,
  PutAttendanceInput,
  SetMeetingStatusInput,
  UpdateDecisionInput,
  UpdateMeetingInput,
} from './meetings.schemas.js'

export async function getMeetings(req: Request, res: Response): Promise<void> {
  const query = req.validated?.query as ListMeetingsQuery
  const { items, total } = await listMeetings(requireContext(req), query)
  sendCollection(
    res,
    items,
    buildPageMeta({ page: query.page, pageSize: query.pageSize, total, sort: query.sort }),
  )
}

export async function getOptions(req: Request, res: Response): Promise<void> {
  sendData(res, await attendanceOptions(requireContext(req)))
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  sendData(res, await getMeeting(requireContext(req), id))
}

export async function postMeeting(req: Request, res: Response): Promise<void> {
  const input = req.validated?.body as CreateMeetingInput
  sendData(res, await createMeeting(requireContext(req), input), 201)
}

export async function patchMeeting(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const changes = req.validated?.body as UpdateMeetingInput
  sendData(res, await updateMeeting(requireContext(req), id, changes))
}

export async function postStatus(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as SetMeetingStatusInput
  sendData(res, await setMeetingStatus(requireContext(req), id, input))
}

export async function putMeetingAgenda(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as PutAgendaInput
  sendData(res, await putAgenda(requireContext(req), id, input))
}

export async function putMeetingAttendance(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as PutAttendanceInput
  sendData(res, await putAttendance(requireContext(req), id, input))
}

export async function postDecision(req: Request, res: Response): Promise<void> {
  const { id } = req.validated?.params as { id: string }
  const input = req.validated?.body as CreateDecisionInput
  sendData(res, await createDecision(requireContext(req), id, input), 201)
}

export async function patchDecision(req: Request, res: Response): Promise<void> {
  const { id, decisionId } = req.validated?.params as { id: string; decisionId: string }
  const changes = req.validated?.body as UpdateDecisionInput
  sendData(res, await updateDecision(requireContext(req), id, decisionId, changes))
}
