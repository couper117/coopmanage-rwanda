import type { Response } from 'express'
import type { ApiCollectionResponse, ApiResponse, PageMeta } from '@coopmanage/shared'

/** Every successful response leaves through one of these, so the envelope cannot drift. */
export function sendData<T>(res: Response, data: T, status = 200): void {
  const body: ApiResponse<T> = { data }
  res.status(status).json(body)
}

export function sendCollection<T>(res: Response, items: T[], meta: PageMeta, status = 200): void {
  const body: ApiCollectionResponse<T> = { data: items, meta }
  res.status(status).json(body)
}

export function sendNoContent(res: Response): void {
  res.status(204).end()
}

export function buildPageMeta(input: {
  page: number
  pageSize: number
  total: number
  sort?: string
}): PageMeta {
  const totalPages = input.pageSize > 0 ? Math.ceil(input.total / input.pageSize) : 0
  return {
    page: input.page,
    pageSize: input.pageSize,
    total: input.total,
    totalPages,
    ...(input.sort ? { sort: input.sort } : {}),
  }
}
