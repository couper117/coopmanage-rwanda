import { z } from 'zod'

/**
 * Assistant validators.
 *
 * The question is capped at 300 characters. Not a technical limit: a question longer than that is
 * a paragraph, and the honest answer to a paragraph is the refusal the planner would give it
 * anyway. The cap keeps a stored thread readable and a log line bounded.
 */
export const askSchema = z
  .object({
    question: z.string().trim().min(3).max(300),
    /** Continues a thread. Omitted starts one, titled by the question. */
    conversationId: z.uuid().optional(),
  })
  .strict()
export type AskInput = z.infer<typeof askSchema>

export const listThreadsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()
export type ListThreadsQuery = z.infer<typeof listThreadsSchema>

export const threadIdSchema = z.object({ id: z.uuid() }).strict()
