import { apiRequest, apiRequestCollection } from '@/lib/apiClient'

/**
 * Ask CoopManage, as the interface sees it.
 *
 * The shape to notice is that an answer has **no prose in it**. The server sends a translation key,
 * its values, the figures behind it and the screen it points at; this side renders the sentence in
 * the reader's language and shows the figures beside it. An answer written as a sentence would be an
 * answer in one language, and a number inside it would be a number nobody could trace.
 */

export interface AssistantFigure {
  /**
   * A translation key, or `literal:<text>` where the label is the cooperative's own words — a
   * category or a product it named itself, which is not ours to translate.
   */
  labelKey: string
  value: string
  type: 'money' | 'number' | 'quantity' | 'text' | 'date'
}

export interface AssistantAnswer {
  conversationId: string
  messageId: string
  answerKey: string
  answerParams: Record<string, unknown>
  figures: AssistantFigure[]
  href: string | null
  /** Which tool answered, or null where nothing fitted and the assistant said so. */
  tool: string | null
}

export interface AssistantCatalogue {
  planner: string
  /**
   * False while the planner matches words rather than understanding language. The screen says so
   * and shows examples, rather than letting a reader phrase a question three ways and conclude the
   * product is broken.
   */
  understandsLanguage: boolean
  tools: { key: string; summaryKey: string }[]
}

export interface ThreadRow {
  id: string
  title: string
  messageCount: number
  updatedAt: string
}

export interface ThreadMessage {
  id: string
  role: 'USER' | 'ASSISTANT'
  question: string | null
  answerKey: string | null
  answerParams: Record<string, unknown> | null
  figures: AssistantFigure[] | null
  tool: string | null
  href: string | null
  createdAt: string
}

export interface Thread {
  id: string
  title: string
  messages: ThreadMessage[]
}

export function askAssistant(question: string, conversationId?: string): Promise<AssistantAnswer> {
  return apiRequest<AssistantAnswer>('/assistant/ask', {
    method: 'POST',
    body: { question, ...(conversationId ? { conversationId } : {}) },
  })
}

export function fetchCatalogue(): Promise<AssistantCatalogue> {
  return apiRequest<AssistantCatalogue>('/assistant/catalogue')
}

export function listThreads(page = 1, pageSize = 20) {
  return apiRequestCollection<ThreadRow>('/assistant/threads', { query: { page, pageSize } })
}

export function fetchThread(id: string): Promise<Thread> {
  return apiRequest<Thread>(`/assistant/threads/${id}`)
}
