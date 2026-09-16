import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApiError } from '@/hooks/useApiErrorMessage'
import { useAuthStore } from '@/stores/authStore'
import { askAssistant, fetchCatalogue, fetchThread, listThreads } from './assistant.api'

/**
 * Server state for the assistant.
 *
 * Asking is a mutation, not a query, and deliberately: it writes the question and the answer into
 * the reader's own thread. It carries **no idempotency key** and is not retried — a repeated
 * question costs a query and adds a line to a thread, which is harmless, and the rule Phase 13 set
 * is that only a `GET` or a keyed mutation repeats.
 */
export const assistantKeys = {
  all: ['assistant'] as const,
  scope: (cooperativeId: string | null) => ['assistant', cooperativeId] as const,
  catalogue: (cooperativeId: string | null) => ['assistant', cooperativeId, 'catalogue'] as const,
  threads: (cooperativeId: string | null) => ['assistant', cooperativeId, 'threads'] as const,
  thread: (cooperativeId: string | null, id: string | undefined) =>
    ['assistant', cooperativeId, 'thread', id] as const,
}

function useCooperativeId(): string | null {
  return useAuthStore((state) => state.activeCooperativeId)
}

export function useAssistantCatalogue() {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: assistantKeys.catalogue(cooperativeId),
    queryFn: fetchCatalogue,
    enabled: cooperativeId !== null,
    // What a reader may ask changes when their role changes, not during a session.
    staleTime: 10 * 60 * 1000,
  })
}

export function useThreads() {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: assistantKeys.threads(cooperativeId),
    queryFn: () => listThreads(),
    enabled: cooperativeId !== null,
  })
}

export function useThread(id: string | undefined) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: assistantKeys.thread(cooperativeId, id),
    queryFn: () => fetchThread(id as string),
    enabled: cooperativeId !== null && id !== undefined,
  })
}

export function useAsk() {
  const queryClient = useQueryClient()
  const cooperativeId = useCooperativeId()
  return useMutation({
    mutationFn: (input: { question: string; conversationId?: string }) =>
      askAssistant(input.question, input.conversationId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: assistantKeys.scope(cooperativeId) }),
  })
}

export function useAssistantError() {
  return useApiError()
}
